import {
  users, projects, tasks, notes, approvedUsers, ambianceProfiles, ulysseFiles, voiceSettings, ulysseHomework, mediaLibrary, faceDescriptors, ulysseCharter,
  subtasks, taskLabels, taskLabelAssignments,
  type User, type InsertUser,
  type Project, type InsertProject,
  type Task, type InsertTask,
  type Note, type InsertNote,
  type ApprovedUser, type InsertApprovedUser,
  type AmbianceProfile, type InsertAmbianceProfile,
  type UlysseFile, type InsertUlysseFile,
  type VoiceSettings, type InsertVoiceSettings,
  type UlysseHomework, type InsertUlysseHomework,
  type MediaLibrary, type InsertMediaLibrary,
  type FaceDescriptor, type InsertFaceDescriptor,
  type UlysseCharter, type InsertUlysseCharter,
  type Subtask, type InsertSubtask,
  type TaskLabel, type InsertTaskLabel,
  type TaskLabelAssignment, type InsertTaskLabelAssignment
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

const MAX_APPROVED_USERS = 3;

/**
 * User Core Context - triplet essentiel pour les services
 */
export interface UserCoreContext {
  user: User;
  charter: UlysseCharter;
  voiceSettings: VoiceSettings | undefined;
  isOwner: boolean;
  isApproved: boolean;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Access Control Helpers (Ulysse Core)
  isOwner(userId: number): Promise<boolean>;
  isOwnerOrApproved(userId: number): Promise<boolean>;
  getUserCoreContext(userId: number): Promise<UserCoreContext>;

  // Approved Users Management (owner only)
  getApprovedUsers(): Promise<ApprovedUser[]>;
  getApprovedUserCount(): Promise<number>;
  addApprovedUser(data: InsertApprovedUser): Promise<ApprovedUser>;
  removeApprovedUser(userId: number): Promise<void>;
  isUserApproved(userId: number): Promise<boolean>;

  // Projects - filtered by userId
  getProjects(userId: number): Promise<Project[]>;
  getProject(id: number, userId: number): Promise<Project | undefined>;
  createProject(project: InsertProject & { userId: number }): Promise<Project>;
  updateProject(id: number, userId: number, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number, userId: number): Promise<void>;

  // Tasks - filtered by userId
  getTasks(userId: number, projectId?: number): Promise<Task[]>;
  getTask(id: number, userId: number): Promise<Task | undefined>;
  createTask(task: InsertTask & { userId: number }): Promise<Task>;
  updateTask(id: number, userId: number, task: Partial<InsertTask>): Promise<Task | undefined>;
  deleteTask(id: number, userId: number): Promise<void>;
  generateNextRecurringTask(task: Task): Promise<Task | undefined>;

  // Subtasks
  getSubtasks(taskId: number): Promise<Subtask[]>;
  getSubtaskWithOwnership(id: number, userId: number): Promise<Subtask | undefined>;
  createSubtask(taskId: number, subtask: Omit<InsertSubtask, 'taskId'>): Promise<Subtask>;
  updateSubtask(id: number, update: Partial<Omit<InsertSubtask, 'taskId'>>): Promise<Subtask | undefined>;
  deleteSubtask(id: number): Promise<void>;

  // Task Labels - filtered by userId
  getTaskLabels(userId: number): Promise<TaskLabel[]>;
  createTaskLabel(label: InsertTaskLabel & { userId: number }): Promise<TaskLabel>;
  deleteTaskLabel(id: number, userId: number): Promise<void>;
  getTaskLabelAssignments(taskId: number, userId: number): Promise<TaskLabel[]>;
  assignLabelToTask(taskId: number, labelId: number): Promise<void>;
  unassignLabelFromTask(taskId: number, labelId: number): Promise<void>;

  // Notes - filtered by userId
  getNotes(userId: number, projectId?: number): Promise<Note[]>;
  getNote(id: number, userId: number): Promise<Note | undefined>;
  createNote(note: InsertNote & { userId: number }): Promise<Note>;
  updateNote(id: number, userId: number, note: Partial<InsertNote>): Promise<Note | undefined>;
  deleteNote(id: number, userId: number): Promise<void>;

  // Ambiance Profiles - filtered by userId
  getAmbianceProfiles(userId: number): Promise<AmbianceProfile[]>;
  getActiveAmbianceProfile(userId: number): Promise<AmbianceProfile | undefined>;
  createAmbianceProfile(profile: InsertAmbianceProfile): Promise<AmbianceProfile>;
  updateAmbianceProfile(id: number, userId: number, profile: Partial<InsertAmbianceProfile>): Promise<AmbianceProfile | undefined>;
  deleteAmbianceProfile(id: number, userId: number): Promise<void>;
  setActiveAmbianceProfile(id: number, userId: number): Promise<AmbianceProfile | undefined>;

  // Ulysse Files - generated files for download
  getUlysseFiles(userId: number): Promise<UlysseFile[]>;
  getUlysseFile(id: number, userId: number): Promise<UlysseFile | undefined>;
  createUlysseFile(file: InsertUlysseFile): Promise<UlysseFile>;
  updateUlysseFileLabel(id: number, label: string | null): Promise<void>;
  deleteUlysseFile(id: number, userId: number): Promise<void>;

  // Voice Settings - TTS and STT preferences
  getVoiceSettings(userId: number): Promise<VoiceSettings | undefined>;
  createOrUpdateVoiceSettings(userId: number, settings: Partial<InsertVoiceSettings>): Promise<VoiceSettings>;

  // Ulysse Homework - background preparation tasks
  getHomework(userId: number): Promise<UlysseHomework[]>;
  getHomeworkItem(id: number, userId: number): Promise<UlysseHomework | undefined>;
  createHomework(homework: InsertUlysseHomework & { userId: number }): Promise<UlysseHomework>;
  updateHomework(id: number, userId: number, homework: Partial<InsertUlysseHomework>): Promise<UlysseHomework | undefined>;
  deleteHomework(id: number, userId: number): Promise<void>;

  // Media Library - photos and videos from camera
  getMedia(userId: number, type?: string): Promise<MediaLibrary[]>;
  getMediaById(id: number): Promise<MediaLibrary | undefined>;
  createMedia(media: InsertMediaLibrary & { userId: number }): Promise<MediaLibrary>;
  toggleMediaFavorite(id: number, userId: number): Promise<MediaLibrary | undefined>;
  deleteMedia(id: number, userId: number): Promise<void>;

  // Face Descriptors - facial recognition
  getFaceDescriptors(userId: number): Promise<FaceDescriptor[]>;
  createFaceDescriptor(data: InsertFaceDescriptor): Promise<FaceDescriptor>;
  deleteFaceDescriptors(userId: number): Promise<void>;

  // Ulysse Charter - persistent behavior rules
  getCharter(userId: number): Promise<UlysseCharter>;
  updateCharter(userId: number, data: Partial<InsertUlysseCharter>): Promise<UlysseCharter>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // ============================================================================
  // Access Control Helpers (Ulysse Core)
  // ============================================================================

  /**
   * Vérifie si l'utilisateur est le propriétaire (Maurice)
   */
  async isOwner(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    return !!user?.isOwner;
  }

  /**
   * Vérifie si l'utilisateur est le propriétaire OU un utilisateur approuvé
   * (toi + tes filles = accès complet à Ulysse)
   */
  async isOwnerOrApproved(userId: number): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;
    if (user.isOwner) return true;
    return this.isUserApproved(userId);
  }

  /**
   * Récupère le contexte complet d'un utilisateur pour les services Core
   * (user + charter + voice settings + statut accès)
   */
  async getUserCoreContext(userId: number): Promise<UserCoreContext> {
    const [user, charter, voice] = await Promise.all([
      this.getUser(userId),
      this.getCharter(userId),
      this.getVoiceSettings(userId),
    ]);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    const isOwner = !!user.isOwner;
    const isApproved = isOwner || await this.isUserApproved(userId);

    return {
      user,
      charter,
      voiceSettings: voice,
      isOwner,
      isApproved,
    };
  }

  // ============================================================================
  // Approved Users Management
  // ============================================================================

  async getApprovedUsers(): Promise<ApprovedUser[]> {
    return db.select().from(approvedUsers);
  }

  async getApprovedUserCount(): Promise<number> {
    const result = await db.select().from(approvedUsers);
    return result.length;
  }

  async addApprovedUser(data: InsertApprovedUser): Promise<ApprovedUser> {
    // 1) Vérifier que l'utilisateur existe
    const user = await this.getUser(data.userId);
    if (!user) {
      throw new Error("CANNOT_APPROVE_UNKNOWN_USER: L'utilisateur n'existe pas");
    }

    // 2) Vérifier qu'il n'est pas déjà approuvé (éviter doublons)
    const existing = await db.select().from(approvedUsers).where(eq(approvedUsers.userId, data.userId));
    if (existing.length > 0) {
      console.log(`[Storage] User ${data.userId} already approved, returning existing`);
      return existing[0];
    }

    // 3) Vérifier la limite max
    const count = await this.getApprovedUserCount();
    if (count >= MAX_APPROVED_USERS) {
      throw new Error(`MAX_APPROVED_USERS: Maximum de ${MAX_APPROVED_USERS} utilisateurs approuvés atteint`);
    }

    // 4) Ajouter l'utilisateur approuvé
    const [approved] = await db.insert(approvedUsers).values(data).returning();
    console.log(`[Storage] User ${data.userId} approved (${count + 1}/${MAX_APPROVED_USERS})`);
    return approved;
  }

  async removeApprovedUser(userId: number): Promise<void> {
    await db.delete(approvedUsers).where(eq(approvedUsers.userId, userId));
  }

  async isUserApproved(userId: number): Promise<boolean> {
    const [result] = await db.select().from(approvedUsers).where(eq(approvedUsers.userId, userId));
    return !!result;
  }

  // Projects - filtered by userId for data isolation
  async getProjects(userId: number): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.userId, userId));
  }

  async getProject(id: number, userId: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(
      and(eq(projects.id, id), eq(projects.userId, userId))
    );
    return project;
  }

  async createProject(insertProject: InsertProject & { userId: number }): Promise<Project> {
    const [project] = await db.insert(projects).values(insertProject).returning();
    return project;
  }

  async updateProject(id: number, userId: number, update: Partial<InsertProject>): Promise<Project | undefined> {
    const [project] = await db.update(projects).set(update).where(
      and(eq(projects.id, id), eq(projects.userId, userId))
    ).returning();
    return project;
  }

  async deleteProject(id: number, userId: number): Promise<void> {
    await db.delete(projects).where(
      and(eq(projects.id, id), eq(projects.userId, userId))
    );
  }

  // Tasks - filtered by userId for data isolation
  async getTasks(userId: number, projectId?: number): Promise<Task[]> {
    if (projectId) {
      return db.select().from(tasks).where(
        and(eq(tasks.userId, userId), eq(tasks.projectId, projectId))
      );
    }
    return db.select().from(tasks).where(eq(tasks.userId, userId));
  }

  async getTask(id: number, userId: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks).where(
      and(eq(tasks.id, id), eq(tasks.userId, userId))
    );
    return task;
  }

  async createTask(insertTask: InsertTask & { userId: number }): Promise<Task> {
    const [task] = await db.insert(tasks).values(insertTask).returning();
    return task;
  }

  async updateTask(id: number, userId: number, update: Partial<InsertTask>): Promise<Task | undefined> {
    const [task] = await db.update(tasks).set(update).where(
      and(eq(tasks.id, id), eq(tasks.userId, userId))
    ).returning();
    return task;
  }

  async deleteTask(id: number, userId: number): Promise<void> {
    // Also delete related subtasks and label assignments
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(
      and(eq(tasks.id, id), eq(tasks.userId, userId))
    );
    if (task) {
      await db.delete(subtasks).where(eq(subtasks.taskId, id));
      await db.delete(taskLabelAssignments).where(eq(taskLabelAssignments.taskId, id));
      await db.delete(tasks).where(eq(tasks.id, id));
    }
  }

  async generateNextRecurringTask(task: Task): Promise<Task | undefined> {
    if (!task.recurrenceType || !task.dueDate) return undefined;

    const interval = task.recurrenceInterval || 1;
    const nextDue = new Date(task.dueDate);

    switch (task.recurrenceType) {
      case 'daily':
        nextDue.setDate(nextDue.getDate() + interval);
        break;
      case 'weekly':
        nextDue.setDate(nextDue.getDate() + (interval * 7));
        break;
      case 'monthly':
        nextDue.setMonth(nextDue.getMonth() + interval);
        break;
      case 'yearly':
        nextDue.setFullYear(nextDue.getFullYear() + interval);
        break;
      default:
        return undefined;
    }

    const [newTask] = await db.insert(tasks).values({
      userId: task.userId,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: 'todo',
      priority: task.priority,
      dueDate: nextDue,
      recurrenceType: task.recurrenceType,
      recurrenceInterval: task.recurrenceInterval,
      parentTaskId: task.parentTaskId || task.id // Original task or chain parent
    }).returning();

    return newTask;
  }

  // Subtasks
  async getSubtasks(taskId: number): Promise<Subtask[]> {
    return db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(subtasks.sortOrder);
  }

  async getSubtaskWithOwnership(id: number, userId: number): Promise<Subtask | undefined> {
    // Join with tasks to verify ownership
    const [result] = await db
      .select({ subtask: subtasks })
      .from(subtasks)
      .innerJoin(tasks, eq(subtasks.taskId, tasks.id))
      .where(and(eq(subtasks.id, id), eq(tasks.userId, userId)));
    return result?.subtask;
  }

  async createSubtask(taskId: number, subtask: Omit<InsertSubtask, 'taskId'>): Promise<Subtask> {
    const [created] = await db.insert(subtasks).values({ ...subtask, taskId }).returning();
    return created;
  }

  async updateSubtask(id: number, update: Partial<Omit<InsertSubtask, 'taskId'>>): Promise<Subtask | undefined> {
    const [updated] = await db.update(subtasks).set(update).where(eq(subtasks.id, id)).returning();
    return updated;
  }

  async deleteSubtask(id: number): Promise<void> {
    await db.delete(subtasks).where(eq(subtasks.id, id));
  }

  // Task Labels
  async getTaskLabels(userId: number): Promise<TaskLabel[]> {
    return db.select().from(taskLabels).where(eq(taskLabels.userId, userId));
  }

  async createTaskLabel(label: InsertTaskLabel & { userId: number }): Promise<TaskLabel> {
    const [created] = await db.insert(taskLabels).values(label).returning();
    return created;
  }

  async deleteTaskLabel(id: number, userId: number): Promise<void> {
    // Also remove assignments
    await db.delete(taskLabelAssignments).where(eq(taskLabelAssignments.labelId, id));
    await db.delete(taskLabels).where(and(eq(taskLabels.id, id), eq(taskLabels.userId, userId)));
  }

  async getTaskLabelAssignments(taskId: number, userId: number): Promise<TaskLabel[]> {
    // Join assignments with labels filtered by userId for data isolation
    const result = await db
      .select({ label: taskLabels })
      .from(taskLabelAssignments)
      .innerJoin(taskLabels, and(
        eq(taskLabelAssignments.labelId, taskLabels.id),
        eq(taskLabels.userId, userId)
      ))
      .where(eq(taskLabelAssignments.taskId, taskId));
    return result.map(r => r.label);
  }

  async assignLabelToTask(taskId: number, labelId: number): Promise<void> {
    await db.insert(taskLabelAssignments).values({ taskId, labelId }).onConflictDoNothing();
  }

  async unassignLabelFromTask(taskId: number, labelId: number): Promise<void> {
    await db.delete(taskLabelAssignments).where(
      and(eq(taskLabelAssignments.taskId, taskId), eq(taskLabelAssignments.labelId, labelId))
    );
  }

  // Notes - filtered by userId for data isolation
  async getNotes(userId: number, projectId?: number): Promise<Note[]> {
    if (projectId) {
      return db.select().from(notes).where(
        and(eq(notes.userId, userId), eq(notes.projectId, projectId))
      );
    }
    return db.select().from(notes).where(eq(notes.userId, userId));
  }

  async getNote(id: number, userId: number): Promise<Note | undefined> {
    const [note] = await db.select().from(notes).where(
      and(eq(notes.id, id), eq(notes.userId, userId))
    );
    return note;
  }

  async createNote(insertNote: InsertNote & { userId: number }): Promise<Note> {
    const [note] = await db.insert(notes).values(insertNote).returning();
    return note;
  }

  async updateNote(id: number, userId: number, update: Partial<InsertNote>): Promise<Note | undefined> {
    const [note] = await db.update(notes).set(update).where(
      and(eq(notes.id, id), eq(notes.userId, userId))
    ).returning();
    return note;
  }

  async deleteNote(id: number, userId: number): Promise<void> {
    await db.delete(notes).where(
      and(eq(notes.id, id), eq(notes.userId, userId))
    );
  }

  // Ambiance Profiles - filtered by userId for data isolation
  async getAmbianceProfiles(userId: number): Promise<AmbianceProfile[]> {
    return db.select().from(ambianceProfiles).where(eq(ambianceProfiles.userId, userId));
  }

  async getActiveAmbianceProfile(userId: number): Promise<AmbianceProfile | undefined> {
    const [profile] = await db.select().from(ambianceProfiles).where(
      and(eq(ambianceProfiles.userId, userId), eq(ambianceProfiles.isActive, true))
    );
    return profile;
  }

  async createAmbianceProfile(profile: InsertAmbianceProfile): Promise<AmbianceProfile> {
    const [created] = await db.insert(ambianceProfiles).values(profile).returning();
    return created;
  }

  async updateAmbianceProfile(id: number, userId: number, update: Partial<InsertAmbianceProfile>): Promise<AmbianceProfile | undefined> {
    const [profile] = await db.update(ambianceProfiles).set(update).where(
      and(eq(ambianceProfiles.id, id), eq(ambianceProfiles.userId, userId))
    ).returning();
    return profile;
  }

  async deleteAmbianceProfile(id: number, userId: number): Promise<void> {
    await db.delete(ambianceProfiles).where(
      and(eq(ambianceProfiles.id, id), eq(ambianceProfiles.userId, userId))
    );
  }

  async setActiveAmbianceProfile(id: number, userId: number): Promise<AmbianceProfile | undefined> {
    // First deactivate all profiles for this user
    await db.update(ambianceProfiles)
      .set({ isActive: false })
      .where(eq(ambianceProfiles.userId, userId));
    
    // Then activate the selected profile
    const [profile] = await db.update(ambianceProfiles)
      .set({ isActive: true })
      .where(and(eq(ambianceProfiles.id, id), eq(ambianceProfiles.userId, userId)))
      .returning();
    return profile;
  }

  // Ulysse Files - generated files for download
  async getUlysseFiles(userId: number): Promise<UlysseFile[]> {
    return db.select().from(ulysseFiles).where(eq(ulysseFiles.userId, userId));
  }

  async getUlysseFile(id: number, userId: number): Promise<UlysseFile | undefined> {
    const [file] = await db.select().from(ulysseFiles).where(
      and(eq(ulysseFiles.id, id), eq(ulysseFiles.userId, userId))
    );
    return file;
  }

  async createUlysseFile(file: InsertUlysseFile): Promise<UlysseFile> {
    const [created] = await db.insert(ulysseFiles).values(file).returning();
    
    // Notify connected clients about new file
    if (file.userId) {
      try {
        const { broadcastToUser } = require('./services/realtimeSync');
        broadcastToUser(file.userId, {
          type: "files.updated",
          userId: file.userId,
          data: { fileId: created.id, action: "created" },
          timestamp: Date.now()
        });
      } catch (e) {
        // Ignore if sync not available
      }
    }
    
    return created;
  }

  async updateUlysseFileLabel(id: number, label: string | null): Promise<void> {
    await db.update(ulysseFiles).set({ versionLabel: label }).where(eq(ulysseFiles.id, id));
  }

  async deleteUlysseFile(id: number, userId: number): Promise<void> {
    await db.delete(ulysseFiles).where(
      and(eq(ulysseFiles.id, id), eq(ulysseFiles.userId, userId))
    );
  }

  // Voice Settings - TTS and STT preferences
  async getVoiceSettings(userId: number): Promise<VoiceSettings | undefined> {
    const [settings] = await db.select().from(voiceSettings).where(eq(voiceSettings.userId, userId));
    return settings;
  }

  async createOrUpdateVoiceSettings(userId: number, update: Partial<InsertVoiceSettings>): Promise<VoiceSettings> {
    const existing = await this.getVoiceSettings(userId);
    if (existing) {
      const [updated] = await db.update(voiceSettings)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(voiceSettings.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(voiceSettings)
        .values({ ...update, userId })
        .returning();
      return created;
    }
  }

  // Ulysse Homework - background preparation tasks
  async getHomework(userId: number): Promise<UlysseHomework[]> {
    return db.select().from(ulysseHomework)
      .where(eq(ulysseHomework.userId, userId))
      .orderBy(desc(ulysseHomework.createdAt)); // DESC pour voir les plus récents en premier
  }

  async getHomeworkItem(id: number, userId: number): Promise<UlysseHomework | undefined> {
    const [item] = await db.select().from(ulysseHomework).where(
      and(eq(ulysseHomework.id, id), eq(ulysseHomework.userId, userId))
    );
    return item;
  }

  async createHomework(homework: InsertUlysseHomework & { userId: number }): Promise<UlysseHomework> {
    const [created] = await db.insert(ulysseHomework).values(homework).returning();
    return created;
  }

  async updateHomework(id: number, userId: number, update: Partial<InsertUlysseHomework>): Promise<UlysseHomework | undefined> {
    const updateData: any = { ...update };
    if (update.status === "completed") {
      updateData.completedAt = new Date();
    }
    const [item] = await db.update(ulysseHomework).set(updateData).where(
      and(eq(ulysseHomework.id, id), eq(ulysseHomework.userId, userId))
    ).returning();
    return item;
  }

  async deleteHomework(id: number, userId: number): Promise<void> {
    await db.delete(ulysseHomework).where(
      and(eq(ulysseHomework.id, id), eq(ulysseHomework.userId, userId))
    );
  }

  // Media Library - photos and videos from camera
  async getMedia(userId: number, type?: string): Promise<MediaLibrary[]> {
    if (type) {
      return db.select().from(mediaLibrary).where(
        and(eq(mediaLibrary.userId, userId), eq(mediaLibrary.type, type))
      );
    }
    return db.select().from(mediaLibrary).where(eq(mediaLibrary.userId, userId));
  }

  async getMediaById(id: number): Promise<MediaLibrary | undefined> {
    const [media] = await db.select().from(mediaLibrary).where(eq(mediaLibrary.id, id));
    return media;
  }

  async createMedia(media: InsertMediaLibrary & { userId: number }): Promise<MediaLibrary> {
    const [created] = await db.insert(mediaLibrary).values(media).returning();
    return created;
  }

  async toggleMediaFavorite(id: number, userId: number): Promise<MediaLibrary | undefined> {
    const existing = await this.getMediaById(id);
    if (!existing || existing.userId !== userId) return undefined;
    
    const [updated] = await db.update(mediaLibrary)
      .set({ isFavorite: !existing.isFavorite })
      .where(and(eq(mediaLibrary.id, id), eq(mediaLibrary.userId, userId)))
      .returning();
    return updated;
  }

  async deleteMedia(id: number, userId: number): Promise<void> {
    await db.delete(mediaLibrary).where(
      and(eq(mediaLibrary.id, id), eq(mediaLibrary.userId, userId))
    );
  }

  // Face Descriptors - facial recognition
  async getFaceDescriptors(userId: number): Promise<FaceDescriptor[]> {
    return db.select().from(faceDescriptors).where(eq(faceDescriptors.userId, userId));
  }

  async createFaceDescriptor(data: InsertFaceDescriptor): Promise<FaceDescriptor> {
    const [created] = await db.insert(faceDescriptors).values(data).returning();
    return created;
  }

  async deleteFaceDescriptors(userId: number): Promise<void> {
    await db.delete(faceDescriptors).where(eq(faceDescriptors.userId, userId));
  }

  // Ulysse Charter - persistent behavior rules
  /**
   * Récupère la charte Ulysse d'un utilisateur
   * Auto-persiste une charte par défaut si aucune n'existe en DB
   */
  async getCharter(userId: number): Promise<UlysseCharter> {
    const [existing] = await db.select().from(ulysseCharter).where(eq(ulysseCharter.userId, userId));
    
    if (existing) {
      return existing;
    }
    
    // Auto-persist: créer la charte par défaut en DB
    const now = new Date();
    const defaults: InsertUlysseCharter = {
      userId,
      communicationStyle: "direct",
      language: "fr",
      responseLength: "concise",
      priorityDomains: [],
      activeProjects: [],
      behaviorRules: [],
      wakeWord: "Ulysse",
      voicePersonality: "professional",
      rememberConversations: true,
      contextRetentionDays: 30,
      proactiveInsights: true,
      dailyBriefEnabled: true,
      dailyBriefTime: "08:00",
      customInstructions: null,
      createdAt: now,
      updatedAt: now,
    };

    const [created] = await db.insert(ulysseCharter).values(defaults).returning();
    console.log(`[Storage] Auto-created default charter for user ${userId}`);
    return created;
  }

  async updateCharter(userId: number, data: Partial<InsertUlysseCharter>): Promise<UlysseCharter> {
    const [existing] = await db.select().from(ulysseCharter).where(eq(ulysseCharter.userId, userId));
    
    const charterData = {
      ...data,
      updatedAt: new Date(),
    };
    
    if (existing) {
      const [updated] = await db.update(ulysseCharter)
        .set(charterData)
        .where(eq(ulysseCharter.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(ulysseCharter)
        .values({ userId, ...charterData })
        .returning();
      return created;
    }
  }
}

export const storage = new DatabaseStorage();
