import * as notionService from "./notionService";

type NotionActionType = 'search' | 'list_databases' | 'query_database' | 'create_page' | 'read_page' | 'append_page';

interface NotionSearchAction {
  type: 'search';
  query: string;
  limit?: number;
}

interface NotionListDatabasesAction {
  type: 'list_databases';
}

interface NotionQueryDatabaseAction {
  type: 'query_database';
  databaseId: string;
  limit?: number;
}

interface NotionCreatePageAction {
  type: 'create_page';
  title: string;
  content: string;
  parentId?: string;
}

interface NotionReadPageAction {
  type: 'read_page';
  pageId: string;
}

interface NotionAppendPageAction {
  type: 'append_page';
  pageId: string;
  content: string;
}

type NotionAction = NotionSearchAction | NotionListDatabasesAction | NotionQueryDatabaseAction |
                    NotionCreatePageAction | NotionReadPageAction | NotionAppendPageAction;

interface NotionActionResult {
  success: boolean;
  type: NotionActionType;
  data?: any;
  summary: string;
  error?: string;
}

const SEARCH_NOTION_PATTERN = /\[NOTION_RECHERCHE\s*:\s*query\s*=\s*"?([^"\]]+)"?(?:\s*,\s*limite\s*=\s*(\d+))?\]/gi;
const LIST_DATABASES_PATTERN = /\[NOTION_BASES\]/gi;
const QUERY_DATABASE_PATTERN = /\[NOTION_QUERY_BASE\s*:\s*id\s*=\s*([^\],]+)(?:\s*,\s*limite\s*=\s*(\d+))?\]/gi;
const CREATE_PAGE_PATTERN = /\[NOTION_CREER_PAGE\s*:\s*titre\s*=\s*"?([^"\],]+)"?\s*,\s*contenu\s*=\s*"?([^"\]]+)"?(?:\s*,\s*parent\s*=\s*([^\]]+))?\]/gi;
const READ_PAGE_PATTERN = /\[NOTION_LIRE_PAGE\s*:\s*id\s*=\s*([^\]]+)\]/gi;
const APPEND_PAGE_PATTERN = /\[NOTION_AJOUTER\s*:\s*id\s*=\s*([^\],]+)\s*,\s*contenu\s*=\s*"?([^"\]]+)"?\]/gi;

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', { 
    day: '2-digit', 
    month: '2-digit', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function parseNotionActions(response: string): NotionAction[] {
  const actions: NotionAction[] = [];

  let match;

  SEARCH_NOTION_PATTERN.lastIndex = 0;
  while ((match = SEARCH_NOTION_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'search',
      query: match[1].trim(),
      limit: match[2] ? parseInt(match[2]) : 20
    });
  }

  LIST_DATABASES_PATTERN.lastIndex = 0;
  while ((match = LIST_DATABASES_PATTERN.exec(response)) !== null) {
    actions.push({ type: 'list_databases' });
  }

  QUERY_DATABASE_PATTERN.lastIndex = 0;
  while ((match = QUERY_DATABASE_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'query_database',
      databaseId: match[1].trim(),
      limit: match[2] ? parseInt(match[2]) : 50
    });
  }

  CREATE_PAGE_PATTERN.lastIndex = 0;
  while ((match = CREATE_PAGE_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'create_page',
      title: match[1].trim(),
      content: match[2].trim(),
      parentId: match[3]?.trim()
    });
  }

  READ_PAGE_PATTERN.lastIndex = 0;
  while ((match = READ_PAGE_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'read_page',
      pageId: match[1].trim()
    });
  }

  APPEND_PAGE_PATTERN.lastIndex = 0;
  while ((match = APPEND_PAGE_PATTERN.exec(response)) !== null) {
    actions.push({
      type: 'append_page',
      pageId: match[1].trim(),
      content: match[2].trim()
    });
  }

  return actions;
}

async function executeSearchAction(action: NotionSearchAction): Promise<NotionActionResult> {
  try {
    const result = await notionService.search(action.query, action.limit);
    
    return {
      success: true,
      type: 'search',
      data: result,
      summary: `Recherche "${action.query}": ${result.pages.length} page(s), ${result.databases.length} base(s) trouvée(s)`
    };
  } catch (error) {
    return {
      success: false,
      type: 'search',
      summary: `Erreur lors de la recherche Notion`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeListDatabasesAction(): Promise<NotionActionResult> {
  try {
    const databases = await notionService.listDatabases();
    
    return {
      success: true,
      type: 'list_databases',
      data: databases,
      summary: `${databases.length} base(s) de données Notion accessibles`
    };
  } catch (error) {
    return {
      success: false,
      type: 'list_databases',
      summary: `Erreur lors de la récupération des bases Notion`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeQueryDatabaseAction(action: NotionQueryDatabaseAction): Promise<NotionActionResult> {
  try {
    const pages = await notionService.queryDatabase(action.databaseId, action.limit);
    
    return {
      success: true,
      type: 'query_database',
      data: pages,
      summary: `${pages.length} entrée(s) dans la base de données`
    };
  } catch (error) {
    return {
      success: false,
      type: 'query_database',
      summary: `Erreur lors de la requête de la base Notion`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeCreatePageAction(action: NotionCreatePageAction): Promise<NotionActionResult> {
  try {
    const page = await notionService.createPage(action.title, action.content, action.parentId);
    
    if (!page) {
      return {
        success: false,
        type: 'create_page',
        summary: `Impossible de créer la page "${action.title}"`,
        error: 'Page creation returned null'
      };
    }
    
    return {
      success: true,
      type: 'create_page',
      data: page,
      summary: `Page "${action.title}" créée avec succès`
    };
  } catch (error) {
    return {
      success: false,
      type: 'create_page',
      summary: `Erreur lors de la création de la page Notion`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeReadPageAction(action: NotionReadPageAction): Promise<NotionActionResult> {
  try {
    const content = await notionService.getPageContent(action.pageId);
    
    return {
      success: true,
      type: 'read_page',
      data: { pageId: action.pageId, content },
      summary: content ? `Contenu récupéré (${content.length} caractères)` : 'Page vide ou sans contenu texte'
    };
  } catch (error) {
    return {
      success: false,
      type: 'read_page',
      summary: `Erreur lors de la lecture de la page Notion`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

async function executeAppendPageAction(action: NotionAppendPageAction): Promise<NotionActionResult> {
  try {
    const success = await notionService.appendToPage(action.pageId, action.content);
    
    return {
      success,
      type: 'append_page',
      summary: success ? `Contenu ajouté à la page` : `Échec de l'ajout du contenu`
    };
  } catch (error) {
    return {
      success: false,
      type: 'append_page',
      summary: `Erreur lors de l'ajout à la page Notion`,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function executeActions(actions: NotionAction[]): Promise<NotionActionResult[]> {
  const results: NotionActionResult[] = [];

  for (const action of actions) {
    let result: NotionActionResult;

    switch (action.type) {
      case 'search':
        result = await executeSearchAction(action);
        break;
      case 'list_databases':
        result = await executeListDatabasesAction();
        break;
      case 'query_database':
        result = await executeQueryDatabaseAction(action);
        break;
      case 'create_page':
        result = await executeCreatePageAction(action);
        break;
      case 'read_page':
        result = await executeReadPageAction(action);
        break;
      case 'append_page':
        result = await executeAppendPageAction(action);
        break;
      default:
        result = {
          success: false,
          type: 'search',
          summary: 'Action Notion non reconnue',
          error: 'Unknown action type'
        };
    }

    results.push(result);
  }

  return results;
}

export function formatResultForUser(result: NotionActionResult): string {
  if (!result.success) {
    return `\n\n**Notion - Erreur**: ${result.summary}${result.error ? ` (${result.error})` : ''}\n`;
  }

  let output = '\n\n';

  switch (result.type) {
    case 'search':
      output += `**Notion - Recherche**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data?.pages?.length > 0) {
        output += `**Pages:**\n`;
        for (const page of result.data.pages.slice(0, 10)) {
          const icon = page.icon || '📄';
          output += `- ${icon} **${page.title}** - [Ouvrir](${page.url})\n`;
          output += `  Modifié: ${formatDate(page.lastEditedTime)}\n`;
        }
      }
      
      if (result.data?.databases?.length > 0) {
        output += `\n**Bases de données:**\n`;
        for (const db of result.data.databases.slice(0, 5)) {
          output += `- 🗄️ **${db.title}** - [Ouvrir](${db.url})\n`;
          if (db.description) output += `  ${db.description}\n`;
        }
      }
      break;

    case 'list_databases':
      output += `**Notion - Bases de données**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data?.length > 0) {
        for (const db of result.data) {
          output += `- 🗄️ **${db.title}**\n`;
          output += `  ID: \`${db.id}\`\n`;
          output += `  [Ouvrir](${db.url})\n`;
          if (db.description) output += `  ${db.description}\n`;
        }
      }
      break;

    case 'query_database':
      output += `**Notion - Contenu de la base**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data?.length > 0) {
        for (const page of result.data.slice(0, 15)) {
          const icon = page.icon || '📄';
          output += `- ${icon} **${page.title}** - [Ouvrir](${page.url})\n`;
        }
        if (result.data.length > 15) {
          output += `\n_...et ${result.data.length - 15} autres entrées_\n`;
        }
      }
      break;

    case 'create_page':
      output += `**Notion - Page créée**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data) {
        output += `- **${result.data.title}**\n`;
        output += `  [Ouvrir la page](${result.data.url})\n`;
      }
      break;

    case 'read_page':
      output += `**Notion - Contenu de la page**\n`;
      output += `${result.summary}\n\n`;
      
      if (result.data?.content) {
        const content = result.data.content.length > 1000 
          ? result.data.content.substring(0, 1000) + '...'
          : result.data.content;
        output += `\`\`\`\n${content}\n\`\`\`\n`;
      }
      break;

    case 'append_page':
      output += `**Notion - Contenu ajouté**\n`;
      output += `${result.summary}\n`;
      break;

    default:
      output += `**Notion**\n${result.summary}\n`;
  }

  return output;
}

export const notionActionService = {
  parseNotionActions,
  executeActions,
  formatResultForUser
};
