import { z } from 'zod';
import { insertProjectSchema, insertTaskSchema, insertNoteSchema, insertSubtaskSchema, insertTaskLabelSchema, projects, tasks, notes, subtasks, taskLabels } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  projects: {
    list: {
      method: 'GET' as const,
      path: '/api/projects',
      responses: {
        200: z.array(z.custom<typeof projects.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/projects/:id',
      responses: {
        200: z.custom<typeof projects.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/projects',
      input: insertProjectSchema,
      responses: {
        201: z.custom<typeof projects.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/projects/:id',
      input: insertProjectSchema.partial(),
      responses: {
        200: z.custom<typeof projects.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/projects/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  tasks: {
    list: {
      method: 'GET' as const,
      path: '/api/tasks',
      input: z.object({
        projectId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof tasks.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/tasks',
      input: insertTaskSchema,
      responses: {
        201: z.custom<typeof tasks.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/tasks/:id',
      input: insertTaskSchema.partial(),
      responses: {
        200: z.custom<typeof tasks.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/tasks/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  subtasks: {
    list: {
      method: 'GET' as const,
      path: '/api/tasks/:taskId/subtasks',
      responses: {
        200: z.array(z.custom<typeof subtasks.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/tasks/:taskId/subtasks',
      input: insertSubtaskSchema.omit({ taskId: true }),
      responses: {
        201: z.custom<typeof subtasks.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/subtasks/:id',
      input: insertSubtaskSchema.partial().omit({ taskId: true }),
      responses: {
        200: z.custom<typeof subtasks.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/subtasks/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  taskLabels: {
    list: {
      method: 'GET' as const,
      path: '/api/labels',
      responses: {
        200: z.array(z.custom<typeof taskLabels.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/labels',
      input: insertTaskLabelSchema.omit({ userId: true }),
      responses: {
        201: z.custom<typeof taskLabels.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/labels/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    assign: {
      method: 'POST' as const,
      path: '/api/tasks/:taskId/labels/:labelId',
      responses: {
        201: z.object({ success: z.boolean() }),
      },
    },
    unassign: {
      method: 'DELETE' as const,
      path: '/api/tasks/:taskId/labels/:labelId',
      responses: {
        204: z.void(),
      },
    },
  },
  notes: {
    list: {
      method: 'GET' as const,
      path: '/api/notes',
      input: z.object({
        projectId: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof notes.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/notes/:id',
      responses: {
        200: z.custom<typeof notes.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/notes',
      input: insertNoteSchema,
      responses: {
        201: z.custom<typeof notes.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/notes/:id',
      input: insertNoteSchema.partial(),
      responses: {
        200: z.custom<typeof notes.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/notes/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
