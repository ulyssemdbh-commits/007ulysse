/**
 * Notion Service - Direct API
 * Manages documents, databases, and pages in Notion
 */

import { Client } from '@notionhq/client';
import { connectorBridge } from './connectorBridge';

let notionAvailable: boolean | null = null;
let lastCheckTime = 0;
let lastErrorLogged = 0;
const CHECK_COOLDOWN_MS = 5 * 60 * 1000;
const ERROR_LOG_COOLDOWN_MS = 60_000;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
const RECONNECT_INTERVAL_MS = 60_000;

async function getAccessToken(): Promise<string> {
  const conn = await connectorBridge.getNotion();
  if (conn.source === 'none') {
    throw new Error('Notion not configured. Set NOTION_API_KEY or NOTION_TOKEN.');
  }
  return conn.apiKey || conn.accessToken || '';
}

async function getUncachableNotionClient(): Promise<Client> {
  const accessToken = await getAccessToken();
  return new Client({ auth: accessToken });
}

function startNotionReconnectLoop() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    if (notionAvailable === true) {
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      return;
    }
    try {
      notionConnectionSettings = null;
      const notion = await getUncachableNotionClient();
      await notion.users.me({});
      notionAvailable = true;
      lastCheckTime = Date.now();
      console.log('[Notion] Reconnected successfully');
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    } catch {
    }
  }, RECONNECT_INTERVAL_MS);
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  createdTime: string;
  lastEditedTime: string;
  parentType: string;
  icon?: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
  description?: string;
}

export interface NotionSearchResult {
  pages: NotionPage[];
  databases: NotionDatabase[];
}

export async function checkNotionConnection(): Promise<boolean> {
  const now = Date.now();
  if (notionAvailable !== null && now - lastCheckTime < CHECK_COOLDOWN_MS) {
    return notionAvailable;
  }

  try {
    const notion = await getUncachableNotionClient();
    await notion.users.me({});
    notionAvailable = true;
    lastCheckTime = now;
    return true;
  } catch (error: any) {
    notionAvailable = false;
    lastCheckTime = now;

    const code = error?.code || error?.status;
    if (now - lastErrorLogged > ERROR_LOG_COOLDOWN_MS) {
      if (code === 'unauthorized' || code === 401) {
        console.log('[Notion] Token invalid — will retry later');
      } else if (error?.message === 'Notion not connected' || error?.message?.includes('not configured')) {
        console.log('[Notion] Not configured — will retry later');
      } else {
        console.log('[Notion] Connection check failed:', error?.message || 'unknown error');
      }
      lastErrorLogged = now;
    }

    startNotionReconnectLoop();
    return false;
  }
}

export async function search(query: string, limit: number = 20): Promise<NotionSearchResult> {
  const notion = await getUncachableNotionClient();
  
  const response = await notion.search({
    query,
    page_size: limit,
    sort: {
      direction: 'descending',
      timestamp: 'last_edited_time'
    }
  });

  const pages: NotionPage[] = [];
  const databases: NotionDatabase[] = [];

  for (const result of response.results) {
    if (result.object === 'page') {
      const page = result as any;
      pages.push({
        id: page.id,
        title: extractPageTitle(page),
        url: page.url,
        createdTime: page.created_time,
        lastEditedTime: page.last_edited_time,
        parentType: page.parent?.type || 'unknown',
        icon: extractIcon(page.icon)
      });
    } else if ((result as any).object === 'database') {
      const db = result as any;
      databases.push({
        id: db.id,
        title: extractDatabaseTitle(db),
        url: db.url,
        description: extractRichTextContent(db.description)
      });
    }
  }

  return { pages, databases };
}

export async function listDatabases(): Promise<NotionDatabase[]> {
  const notion = await getUncachableNotionClient();
  
  const response = await notion.search({
    filter: {
      property: 'object',
      value: 'database' as any
    },
    page_size: 100
  });

  return response.results
    .filter((item: any) => item.object === 'database')
    .map((db: any) => ({
      id: db.id,
      title: extractDatabaseTitle(db),
      url: db.url,
      description: extractRichTextContent(db.description)
    }));
}

export async function queryDatabase(
  databaseId: string, 
  limit: number = 50
): Promise<NotionPage[]> {
  try {
    const accessToken = await getAccessToken();
    
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page_size: limit
      })
    });
    
    if (!response.ok) {
      throw new Error(`Notion API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return (data.results || []).map((page: any) => ({
      id: page.id,
      title: extractPageTitle(page),
      url: page.url,
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      parentType: 'database',
      icon: extractIcon(page.icon)
    }));
  } catch (error) {
    console.error('[Notion] Query database failed:', error);
    return [];
  }
}

export async function createDatabasePage(
  databaseId: string,
  properties: Record<string, any>
): Promise<NotionPage | null> {
  try {
    const notion = await getUncachableNotionClient();
    
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties
    }) as any;

    console.log(`[Notion] Created page in database: ${databaseId}`);
    
    return {
      id: response.id,
      title: extractPageTitle(response),
      url: response.url,
      createdTime: response.created_time,
      lastEditedTime: response.last_edited_time,
      parentType: 'database',
      icon: extractIcon(response.icon)
    };
  } catch (error) {
    console.error('[Notion] Create database page failed:', error);
    return null;
  }
}

export async function createPage(
  title: string,
  content: string,
  parentPageId?: string
): Promise<NotionPage | null> {
  try {
    const notion = await getUncachableNotionClient();
    
    let parent: any;
    if (parentPageId) {
      parent = { page_id: parentPageId };
    } else {
      const searchResult = await search('', 1);
      if (searchResult.pages.length > 0) {
        parent = { page_id: searchResult.pages[0].id };
      } else {
        throw new Error('No accessible parent page found');
      }
    }
    
    const response = await notion.pages.create({
      parent,
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content } }]
          }
        }
      ]
    }) as any;

    console.log(`[Notion] Created page: ${title}`);
    
    return {
      id: response.id,
      title,
      url: response.url,
      createdTime: response.created_time,
      lastEditedTime: response.last_edited_time,
      parentType: 'page',
      icon: extractIcon(response.icon)
    };
  } catch (error) {
    console.error('[Notion] Create page failed:', error);
    return null;
  }
}

export async function appendToPage(
  pageId: string,
  content: string
): Promise<boolean> {
  try {
    const notion = await getUncachableNotionClient();
    
    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content } }]
          }
        }
      ]
    });

    console.log(`[Notion] Appended content to page: ${pageId}`);
    return true;
  } catch (error) {
    console.error('[Notion] Append to page failed:', error);
    return false;
  }
}

export async function getPageContent(pageId: string): Promise<string> {
  try {
    const notion = await getUncachableNotionClient();
    
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });

    let content = '';
    for (const block of response.results as any[]) {
      const text = extractBlockText(block);
      if (text) {
        content += text + '\n';
      }
    }

    return content.trim();
  } catch (error) {
    console.error('[Notion] Get page content failed:', error);
    return '';
  }
}

function extractPageTitle(page: any): string {
  const titleProp = page.properties?.title || page.properties?.Name || page.properties?.name;
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text;
  }
  for (const key of Object.keys(page.properties || {})) {
    const prop = page.properties[key];
    if (prop?.type === 'title' && prop.title?.[0]?.plain_text) {
      return prop.title[0].plain_text;
    }
  }
  return 'Untitled';
}

function extractDatabaseTitle(db: any): string {
  if (db.title?.[0]?.plain_text) {
    return db.title[0].plain_text;
  }
  return 'Untitled Database';
}

function extractRichTextContent(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map(t => t.plain_text || '').join('');
}

function extractIcon(icon: any): string | undefined {
  if (!icon) return undefined;
  if (icon.type === 'emoji') return icon.emoji;
  if (icon.type === 'external') return icon.external?.url;
  if (icon.type === 'file') return icon.file?.url;
  return undefined;
}

function extractBlockText(block: any): string {
  const type = block.type;
  const content = block[type];
  
  if (!content) return '';
  
  if (content.rich_text) {
    return extractRichTextContent(content.rich_text);
  }
  
  return '';
}

export default {
  checkNotionConnection,
  search,
  listDatabases,
  queryDatabase,
  createDatabasePage,
  createPage,
  appendToPage,
  getPageContent
};
