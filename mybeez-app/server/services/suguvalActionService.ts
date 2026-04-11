import { suguvalService } from "./suguvalService";
import { sugumaillaneService } from "./sugumaillaneService";
import { db } from "../db";
import { suguvalEmailLogs, sugumaillaneEmailLogs } from "@shared/schema";
import { desc } from "drizzle-orm";

type Restaurant = 'suguval' | 'sugumaillane';

interface SuguConsultAction {
  type: 'consult';
  restaurant: Restaurant;
}

interface SuguEmailAction {
  type: 'email';
  restaurant: Restaurant;
}

interface SuguHistoryAction {
  type: 'history';
  restaurant: Restaurant;
  limit?: number;
}

interface SuguListItemsAction {
  type: 'list_items';
  restaurant: Restaurant;
}

interface SuguListCategoriesAction {
  type: 'list_categories';
  restaurant: Restaurant;
}

interface SuguEditItemAction {
  type: 'edit_item';
  restaurant: Restaurant;
  itemId: number;
  name?: string;
  nameVi?: string;
  nameTh?: string;
  categoryId?: number;
}

interface SuguRenameCategoryAction {
  type: 'rename_category';
  restaurant: Restaurant;
  categoryId: number;
  name: string;
}

interface SuguReorderCategoriesAction {
  type: 'reorder_categories';
  restaurant: Restaurant;
  ids: number[];
}

interface SuguAddItemAction {
  type: 'add_item';
  restaurant: Restaurant;
  categoryName: string;
  name: string;
  nameVi?: string;
  nameTh?: string;
}

interface SuguDeleteItemAction {
  type: 'delete_item';
  restaurant: Restaurant;
  itemId: number;
}

interface SuguAddCategoryAction {
  type: 'add_category';
  restaurant: Restaurant;
  name: string;
  zone: number;
}

interface SuguDeleteCategoryAction {
  type: 'delete_category';
  restaurant: Restaurant;
  categoryId: number;
}

interface SuguMoveItemAction {
  type: 'move_item';
  restaurant: Restaurant;
  itemId: number;
  toCategoryId: number;
}

type SuguAction = SuguConsultAction | SuguEmailAction | SuguHistoryAction | SuguListItemsAction | SuguListCategoriesAction | SuguEditItemAction | SuguRenameCategoryAction | SuguReorderCategoriesAction | SuguAddItemAction | SuguDeleteItemAction | SuguAddCategoryAction | SuguDeleteCategoryAction | SuguMoveItemAction;

interface SuguConsultResult {
  success: boolean;
  type: 'consult';
  restaurant: Restaurant;
  data?: {
    date: string;
    totalItems: number;
    checkedCount: number;
    checkedItems: Array<{ name: string; category: string }>;
    summary: string;
  };
  error?: string;
}

interface SuguEmailResult {
  success: boolean;
  type: 'email';
  restaurant: Restaurant;
  message?: string;
  error?: string;
}

interface SuguHistoryResult {
  success: boolean;
  type: 'history';
  restaurant: Restaurant;
  data?: {
    entries: Array<{ date: string; itemCount: number; itemsList: string }>;
    summary: string;
  };
  error?: string;
}

interface SuguManageResult {
  success: boolean;
  type: 'list_items' | 'list_categories' | 'edit_item' | 'rename_category' | 'reorder_categories' | 'add_item' | 'delete_item' | 'add_category' | 'delete_category' | 'move_item';
  restaurant: Restaurant;
  data?: any;
  message?: string;
  error?: string;
}

type SuguActionResult = SuguConsultResult | SuguEmailResult | SuguHistoryResult | SuguManageResult;

const CONSULT_SUGUVAL_PATTERN = /\[CONSULTE_SUGUVAL\]/gi;
const CONSULT_SUGUMAILLANE_PATTERN = /\[CONSULTE_SUGUMAILLANE\]/gi;
const EMAIL_SUGUVAL_PATTERN = /\[EMAIL_SUGUVAL_PANIER\]/gi;
const EMAIL_SUGUMAILLANE_PATTERN = /\[EMAIL_SUGUMAILLANE_PANIER\]/gi;
const HISTORY_SUGUVAL_PATTERN = /\[ANALYSE_SUGUVAL_HISTORY(?:\s*:\s*limite\s*=\s*(\d+))?\]/gi;
const HISTORY_SUGUMAILLANE_PATTERN = /\[ANALYSE_SUGUMAILLANE_HISTORY(?:\s*:\s*limite\s*=\s*(\d+))?\]/gi;

// New patterns for item/category management
const LIST_ITEMS_PATTERN = /\[LIST_SUGUVAL_ITEMS\]/gi;
const LIST_CATEGORIES_PATTERN = /\[LIST_SUGUVAL_CATEGORIES\]/gi;
const EDIT_ITEM_PATTERN = /\[EDIT_SUGUVAL_ITEM:\s*id\s*=\s*(\d+)(?:,\s*name\s*=\s*"([^"]*)")?(?:,\s*nameVi\s*=\s*"([^"]*)")?(?:,\s*nameTh\s*=\s*"([^"]*)")?(?:,\s*categoryId\s*=\s*(\d+))?\]/gi;
const RENAME_CATEGORY_PATTERN = /\[RENAME_SUGUVAL_CATEGORY:\s*id\s*=\s*(\d+),\s*name\s*=\s*"([^"]*)"\]/gi;
const REORDER_CATEGORIES_PATTERN = /\[REORDER_SUGUVAL_CATEGORIES:\s*ids\s*=\s*\[([^\]]+)\]\]/gi;
const ADD_ITEM_PATTERN = /\[ADD_SUGUVAL_ITEM:\s*category\s*=\s*"([^"]*)",\s*name\s*=\s*"([^"]*)"(?:,\s*nameVi\s*=\s*"([^"]*)")?(?:,\s*nameTh\s*=\s*"([^"]*)")?\]/gi;
const DELETE_ITEM_PATTERN = /\[DELETE_SUGUVAL_ITEM:\s*id\s*=\s*(\d+)\]/gi;
const ADD_CATEGORY_PATTERN = /\[ADD_SUGUVAL_CATEGORY:\s*name\s*=\s*"([^"]*)"(?:,\s*zone\s*=\s*(\d+))?\]/gi;
const DELETE_CATEGORY_PATTERN = /\[DELETE_SUGUVAL_CATEGORY:\s*id\s*=\s*(\d+)\]/gi;
const MOVE_ITEM_PATTERN = /\[MOVE_SUGUVAL_ITEM:\s*id\s*=\s*(\d+),\s*toCategory\s*=\s*(\d+)\]/gi;

class SuguvalActionService {
  parseSuguActions(text: string): SuguAction[] {
    const actions: SuguAction[] = [];
    let match;
    
    if (CONSULT_SUGUVAL_PATTERN.test(text)) {
      actions.push({ type: 'consult', restaurant: 'suguval' });
    }
    CONSULT_SUGUVAL_PATTERN.lastIndex = 0;
    
    if (CONSULT_SUGUMAILLANE_PATTERN.test(text)) {
      actions.push({ type: 'consult', restaurant: 'sugumaillane' });
    }
    CONSULT_SUGUMAILLANE_PATTERN.lastIndex = 0;
    
    if (EMAIL_SUGUVAL_PATTERN.test(text)) {
      actions.push({ type: 'email', restaurant: 'suguval' });
    }
    EMAIL_SUGUVAL_PATTERN.lastIndex = 0;
    
    if (EMAIL_SUGUMAILLANE_PATTERN.test(text)) {
      actions.push({ type: 'email', restaurant: 'sugumaillane' });
    }
    EMAIL_SUGUMAILLANE_PATTERN.lastIndex = 0;
    
    HISTORY_SUGUVAL_PATTERN.lastIndex = 0;
    if ((match = HISTORY_SUGUVAL_PATTERN.exec(text)) !== null) {
      actions.push({ type: 'history', restaurant: 'suguval', limit: match[1] ? parseInt(match[1]) : 10 });
    }
    
    HISTORY_SUGUMAILLANE_PATTERN.lastIndex = 0;
    if ((match = HISTORY_SUGUMAILLANE_PATTERN.exec(text)) !== null) {
      actions.push({ type: 'history', restaurant: 'sugumaillane', limit: match[1] ? parseInt(match[1]) : 10 });
    }
    
    // New management actions (Suguval only for now)
    if (LIST_ITEMS_PATTERN.test(text)) {
      actions.push({ type: 'list_items', restaurant: 'suguval' });
    }
    LIST_ITEMS_PATTERN.lastIndex = 0;
    
    if (LIST_CATEGORIES_PATTERN.test(text)) {
      actions.push({ type: 'list_categories', restaurant: 'suguval' });
    }
    LIST_CATEGORIES_PATTERN.lastIndex = 0;
    
    EDIT_ITEM_PATTERN.lastIndex = 0;
    while ((match = EDIT_ITEM_PATTERN.exec(text)) !== null) {
      actions.push({
        type: 'edit_item',
        restaurant: 'suguval',
        itemId: parseInt(match[1]),
        name: match[2] || undefined,
        nameVi: match[3] || undefined,
        nameTh: match[4] || undefined,
        categoryId: match[5] ? parseInt(match[5]) : undefined
      });
    }
    
    RENAME_CATEGORY_PATTERN.lastIndex = 0;
    while ((match = RENAME_CATEGORY_PATTERN.exec(text)) !== null) {
      actions.push({
        type: 'rename_category',
        restaurant: 'suguval',
        categoryId: parseInt(match[1]),
        name: match[2]
      });
    }
    
    REORDER_CATEGORIES_PATTERN.lastIndex = 0;
    if ((match = REORDER_CATEGORIES_PATTERN.exec(text)) !== null) {
      const ids = match[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (ids.length > 0) {
        actions.push({ type: 'reorder_categories', restaurant: 'suguval', ids });
      }
    }
    
    ADD_ITEM_PATTERN.lastIndex = 0;
    while ((match = ADD_ITEM_PATTERN.exec(text)) !== null) {
      actions.push({
        type: 'add_item',
        restaurant: 'suguval',
        categoryName: match[1],
        name: match[2],
        nameVi: match[3] || undefined,
        nameTh: match[4] || undefined
      });
    }
    
    DELETE_ITEM_PATTERN.lastIndex = 0;
    while ((match = DELETE_ITEM_PATTERN.exec(text)) !== null) {
      actions.push({ type: 'delete_item', restaurant: 'suguval', itemId: parseInt(match[1]) });
    }
    
    ADD_CATEGORY_PATTERN.lastIndex = 0;
    while ((match = ADD_CATEGORY_PATTERN.exec(text)) !== null) {
      actions.push({
        type: 'add_category',
        restaurant: 'suguval',
        name: match[1],
        zone: match[2] ? parseInt(match[2]) : 1 // Default to zone 1 (CUISINE)
      });
    }
    
    DELETE_CATEGORY_PATTERN.lastIndex = 0;
    while ((match = DELETE_CATEGORY_PATTERN.exec(text)) !== null) {
      actions.push({ type: 'delete_category', restaurant: 'suguval', categoryId: parseInt(match[1]) });
    }
    
    MOVE_ITEM_PATTERN.lastIndex = 0;
    while ((match = MOVE_ITEM_PATTERN.exec(text)) !== null) {
      actions.push({
        type: 'move_item',
        restaurant: 'suguval',
        itemId: parseInt(match[1]),
        toCategoryId: parseInt(match[2])
      });
    }
    
    return actions;
  }

  async executeActions(actions: SuguAction[], userId: number): Promise<SuguActionResult[]> {
    const results: SuguActionResult[] = [];

    for (const action of actions) {
      if (action.type === 'consult') {
        const result = await this.executeConsultAction(action);
        results.push(result);
      } else if (action.type === 'email') {
        const result = await this.executeEmailAction(action);
        results.push(result);
      } else if (action.type === 'history') {
        const result = await this.executeHistoryAction(action);
        results.push(result);
      } else if (action.type === 'list_items') {
        const result = await this.executeListItemsAction(action);
        results.push(result);
      } else if (action.type === 'list_categories') {
        const result = await this.executeListCategoriesAction(action);
        results.push(result);
      } else if (action.type === 'edit_item') {
        const result = await this.executeEditItemAction(action);
        results.push(result);
      } else if (action.type === 'rename_category') {
        const result = await this.executeRenameCategoryAction(action);
        results.push(result);
      } else if (action.type === 'reorder_categories') {
        const result = await this.executeReorderCategoriesAction(action);
        results.push(result);
      } else if (action.type === 'add_item') {
        const result = await this.executeAddItemAction(action);
        results.push(result);
      } else if (action.type === 'delete_item') {
        const result = await this.executeDeleteItemAction(action);
        results.push(result);
      } else if (action.type === 'add_category') {
        const result = await this.executeAddCategoryAction(action);
        results.push(result);
      } else if (action.type === 'delete_category') {
        const result = await this.executeDeleteCategoryAction(action);
        results.push(result);
      } else if (action.type === 'move_item') {
        const result = await this.executeMoveItemAction(action);
        results.push(result);
      }
    }

    return results;
  }

  private async executeConsultAction(action: SuguConsultAction): Promise<SuguConsultResult> {
    try {
      const service = action.restaurant === 'suguval' ? suguvalService : sugumaillaneService;
      const restaurantName = action.restaurant === 'suguval' ? 'SUGU Valentine' : 'SUGU Maillane';
      
      console.log(`[SuguvalAction] Consulting ${restaurantName} cart...`);
      
      const checkedItems = await service.getCheckedItemsForToday();
      
      const today = new Date();
      const parisDate = new Date(today.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
      const dateStr = parisDate.toISOString().split("T")[0];
      
      const itemsByCategory: Record<string, string[]> = {};
      for (const item of checkedItems) {
        if (!itemsByCategory[item.categoryName]) {
          itemsByCategory[item.categoryName] = [];
        }
        itemsByCategory[item.categoryName].push(item.itemName);
      }
      
      let summary = `**${restaurantName} - Panier du ${dateStr}**\n`;
      summary += `${checkedItems.length} article(s) coché(s)\n\n`;
      
      if (checkedItems.length > 0) {
        for (const [category, items] of Object.entries(itemsByCategory)) {
          summary += `**${category}** (${items.length}):\n`;
          for (const item of items) {
            summary += `  - ${item}\n`;
          }
          summary += '\n';
        }
      } else {
        summary += '_Aucun article coché pour aujourd\'hui._\n';
      }
      
      console.log(`[SuguvalAction] ${restaurantName}: ${checkedItems.length} items checked`);
      
      return {
        success: true,
        type: 'consult',
        restaurant: action.restaurant,
        data: {
          date: dateStr,
          totalItems: checkedItems.length,
          checkedCount: checkedItems.length,
          checkedItems: checkedItems.map(i => ({ name: i.itemName, category: i.categoryName })),
          summary
        }
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Consult error for ${action.restaurant}:`, error);
      return {
        success: false,
        type: 'consult',
        restaurant: action.restaurant,
        error: error.message || 'Erreur lors de la consultation'
      };
    }
  }

  private async executeEmailAction(action: SuguEmailAction): Promise<SuguEmailResult> {
    try {
      const service = action.restaurant === 'suguval' ? suguvalService : sugumaillaneService;
      const restaurantName = action.restaurant === 'suguval' ? 'SUGU Valentine' : 'SUGU Maillane';
      
      console.log(`[SuguvalAction] Sending email for ${restaurantName}...`);
      
      const result = await service.sendDailyEmail();
      
      if (result.success) {
        return {
          success: true,
          type: 'email',
          restaurant: action.restaurant,
          message: `Email récapitulatif ${restaurantName} envoyé avec succès.`
        };
      } else {
        return {
          success: false,
          type: 'email',
          restaurant: action.restaurant,
          error: result.message || 'Erreur lors de l\'envoi'
        };
      }
    } catch (error: any) {
      console.error(`[SuguvalAction] Email error for ${action.restaurant}:`, error);
      return {
        success: false,
        type: 'email',
        restaurant: action.restaurant,
        error: error.message || 'Erreur lors de l\'envoi de l\'email'
      };
    }
  }

  private async executeHistoryAction(action: SuguHistoryAction): Promise<SuguHistoryResult> {
    try {
      const restaurantName = action.restaurant === 'suguval' ? 'SUGU Valentine' : 'SUGU Maillane';
      const table = action.restaurant === 'suguval' ? suguvalEmailLogs : sugumaillaneEmailLogs;
      const limit = action.limit || 10;
      
      console.log(`[SuguvalAction] Getting history for ${restaurantName} (limit: ${limit})...`);
      
      const logs = await db
        .select()
        .from(table)
        .orderBy(desc(table.sentAt))
        .limit(limit);
      
      let summary = `**${restaurantName} - Historique des ${logs.length} derniers paniers**\n\n`;
      
      if (logs.length > 0) {
        let totalItems = 0;
        const itemFrequency: Record<string, number> = {};
        
        for (const log of logs) {
          totalItems += log.itemCount;
          summary += `**${log.emailDate}** - ${log.itemCount} article(s)\n`;
          
          const items = log.itemsList.split('\n').filter(i => i.trim());
          for (const item of items) {
            const cleanItem = item.replace(/^[-•]\s*/, '').trim();
            if (cleanItem) {
              itemFrequency[cleanItem] = (itemFrequency[cleanItem] || 0) + 1;
            }
          }
        }
        
        summary += `\n**Statistiques:**\n`;
        summary += `- Total articles: ${totalItems}\n`;
        summary += `- Moyenne par panier: ${(totalItems / logs.length).toFixed(1)}\n`;
        
        const sortedItems = Object.entries(itemFrequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
        
        if (sortedItems.length > 0) {
          summary += `\n**Top ${sortedItems.length} articles les plus achetés:**\n`;
          for (const [item, count] of sortedItems) {
            summary += `- ${item}: ${count} fois\n`;
          }
        }
      } else {
        summary += '_Aucun historique disponible._\n';
      }
      
      console.log(`[SuguvalAction] ${restaurantName}: ${logs.length} history entries found`);
      
      return {
        success: true,
        type: 'history',
        restaurant: action.restaurant,
        data: {
          entries: logs.map(l => ({ date: l.emailDate, itemCount: l.itemCount, itemsList: l.itemsList })),
          summary
        }
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] History error for ${action.restaurant}:`, error);
      return {
        success: false,
        type: 'history',
        restaurant: action.restaurant,
        error: error.message || 'Erreur lors de la récupération de l\'historique'
      };
    }
  }

  // New management action handlers
  private async executeListItemsAction(action: SuguListItemsAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Listing all items for management...`);
      const categories = await suguvalService.getCategoriesWithItems();
      
      let summary = `**Liste des articles Suguval (pour modification)**\n\n`;
      let totalItems = 0;
      
      for (const cat of categories) {
        summary += `📁 **${cat.name}** (ID: ${cat.id})\n`;
        for (const item of cat.items) {
          totalItems++;
          summary += `  • ID ${item.id}: ${item.name}`;
          if (item.nameVi) summary += ` | VN: ${item.nameVi}`;
          if (item.nameTh) summary += ` | TH: ${item.nameTh}`;
          summary += `\n`;
        }
        summary += `\n`;
      }
      
      summary += `\n**Total:** ${totalItems} articles dans ${categories.length} catégories`;
      
      return {
        success: true,
        type: 'list_items',
        restaurant: 'suguval',
        data: { categories, totalItems },
        message: summary
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] List items error:`, error);
      return { success: false, type: 'list_items', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeListCategoriesAction(action: SuguListCategoriesAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Listing categories for management...`);
      const categories = await suguvalService.getCategories();
      
      let summary = `**Catégories Suguval**\n\n`;
      for (const cat of categories) {
        summary += `• ID ${cat.id}: ${cat.name} (zone ${cat.zone || 1})\n`;
      }
      
      return {
        success: true,
        type: 'list_categories',
        restaurant: 'suguval',
        data: { categories },
        message: summary
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] List categories error:`, error);
      return { success: false, type: 'list_categories', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeEditItemAction(action: SuguEditItemAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Editing item ${action.itemId}...`);
      
      const updates: Record<string, any> = {};
      if (action.name !== undefined) updates.name = action.name;
      if (action.nameVi !== undefined) updates.nameVi = action.nameVi;
      if (action.nameTh !== undefined) updates.nameTh = action.nameTh;
      if (action.categoryId !== undefined) updates.categoryId = action.categoryId;
      
      if (Object.keys(updates).length === 0) {
        return { success: false, type: 'edit_item', restaurant: 'suguval', error: 'Aucune modification spécifiée' };
      }
      
      await suguvalService.updateItem(action.itemId, updates);
      
      return {
        success: true,
        type: 'edit_item',
        restaurant: 'suguval',
        message: `Article ID ${action.itemId} modifié avec succès.`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Edit item error:`, error);
      return { success: false, type: 'edit_item', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeRenameCategoryAction(action: SuguRenameCategoryAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Renaming category ${action.categoryId} to "${action.name}"...`);
      await suguvalService.updateCategory(action.categoryId, { name: action.name });
      
      return {
        success: true,
        type: 'rename_category',
        restaurant: 'suguval',
        message: `Catégorie ID ${action.categoryId} renommée en "${action.name}".`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Rename category error:`, error);
      return { success: false, type: 'rename_category', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeReorderCategoriesAction(action: SuguReorderCategoriesAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Reordering categories: ${action.ids.join(', ')}...`);
      await suguvalService.reorderCategories(action.ids);
      
      return {
        success: true,
        type: 'reorder_categories',
        restaurant: 'suguval',
        message: `Catégories réordonnées avec succès.`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Reorder categories error:`, error);
      return { success: false, type: 'reorder_categories', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeAddItemAction(action: SuguAddItemAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Adding item "${action.name}" to category "${action.categoryName}"...`);
      
      // Find category by name
      const categories = await suguvalService.getCategories();
      const category = categories.find(c => c.name.toLowerCase() === action.categoryName.toLowerCase());
      
      if (!category) {
        return { success: false, type: 'add_item', restaurant: 'suguval', error: `Catégorie "${action.categoryName}" introuvable` };
      }
      
      const newItem = await suguvalService.addItem({
        categoryId: category.id,
        name: action.name,
        nameVi: action.nameVi || null,
        nameTh: action.nameTh || null
      });
      
      return {
        success: true,
        type: 'add_item',
        restaurant: 'suguval',
        data: { item: newItem },
        message: `Article "${action.name}" ajouté à la catégorie "${category.name}" (ID: ${newItem.id}).`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Add item error:`, error);
      return { success: false, type: 'add_item', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeDeleteItemAction(action: SuguDeleteItemAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Deleting item ${action.itemId}...`);
      await suguvalService.deleteItem(action.itemId);
      
      return {
        success: true,
        type: 'delete_item',
        restaurant: 'suguval',
        message: `Article ID ${action.itemId} supprimé avec succès.`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Delete item error:`, error);
      return { success: false, type: 'delete_item', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeAddCategoryAction(action: SuguAddCategoryAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Adding category "${action.name}" in zone ${action.zone}...`);
      const newCategory = await suguvalService.addCategory(action.name, action.zone);
      
      return {
        success: true,
        type: 'add_category',
        restaurant: 'suguval',
        data: { category: newCategory },
        message: `Catégorie "${action.name}" créée (ID: ${newCategory.id}, Zone: ${action.zone}).`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Add category error:`, error);
      return { success: false, type: 'add_category', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeDeleteCategoryAction(action: SuguDeleteCategoryAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Deleting category ${action.categoryId}...`);
      
      // Get category info before deletion for message
      const categories = await suguvalService.getCategories();
      const category = categories.find(c => c.id === action.categoryId);
      const categoryName = category?.name || `ID ${action.categoryId}`;
      
      await suguvalService.deleteCategory(action.categoryId);
      
      return {
        success: true,
        type: 'delete_category',
        restaurant: 'suguval',
        message: `Catégorie "${categoryName}" et tous ses articles supprimés.`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Delete category error:`, error);
      return { success: false, type: 'delete_category', restaurant: 'suguval', error: error.message };
    }
  }

  private async executeMoveItemAction(action: SuguMoveItemAction): Promise<SuguManageResult> {
    try {
      console.log(`[SuguvalAction] Moving item ${action.itemId} to category ${action.toCategoryId}...`);
      
      // Get category name for message
      const categories = await suguvalService.getCategories();
      const targetCategory = categories.find(c => c.id === action.toCategoryId);
      
      if (!targetCategory) {
        return { success: false, type: 'move_item', restaurant: 'suguval', error: `Catégorie ID ${action.toCategoryId} introuvable` };
      }
      
      await suguvalService.updateItem(action.itemId, { categoryId: action.toCategoryId });
      
      return {
        success: true,
        type: 'move_item',
        restaurant: 'suguval',
        message: `Article ID ${action.itemId} déplacé vers "${targetCategory.name}".`
      };
    } catch (error: any) {
      console.error(`[SuguvalAction] Move item error:`, error);
      return { success: false, type: 'move_item', restaurant: 'suguval', error: error.message };
    }
  }

  formatResultForUser(result: SuguActionResult): string {
    if (result.type === 'consult') {
      if (result.success && result.data) {
        return `\n\n${result.data.summary}`;
      } else {
        return `\n\n**Erreur:** ${result.error}`;
      }
    } else if (result.type === 'email') {
      if (result.success) {
        return `\n\n${result.message}`;
      } else {
        return `\n\n**Erreur email:** ${result.error}`;
      }
    } else if (result.type === 'history') {
      if (result.success && result.data) {
        return `\n\n${result.data.summary}`;
      } else {
        return `\n\n**Erreur historique:** ${result.error}`;
      }
    } else if (result.type === 'list_items' || result.type === 'list_categories') {
      if (result.success && result.message) {
        return `\n\n${result.message}`;
      } else {
        return `\n\n**Erreur:** ${result.error}`;
      }
    } else if (['edit_item', 'rename_category', 'reorder_categories', 'add_item', 'delete_item', 'add_category', 'delete_category', 'move_item'].includes(result.type)) {
      if (result.success) {
        return `\n\n✅ ${result.message}`;
      } else {
        return `\n\n❌ **Erreur:** ${result.error}`;
      }
    }
    return '';
  }
}

export const suguvalActionService = new SuguvalActionService();
