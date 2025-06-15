import { z } from "zod";

// Gemini API Response Schema
export const GeminiResponseSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({
        text: z.string(),
      })),
      role: z.string(),
    }),
    finishReason: z.string().optional(),
    index: z.number(),
    safetyRatings: z.array(z.object({
      category: z.string(),
      probability: z.string(),
    })).optional(),
  })),
  usageMetadata: z.object({
    promptTokenCount: z.number(),
    candidatesTokenCount: z.number(),
    totalTokenCount: z.number(),
  }).optional(),
});

export type GeminiResponse = z.infer<typeof GeminiResponseSchema>;

// PLaMo Translator API Response Schema
export const PlamoTranslationResponseSchema = z.object({
  generated_text: z.string(),
});

export type PlamoTranslationResponse = z.infer<
  typeof PlamoTranslationResponseSchema
>;

// Devcontainer Config Schema
export const DevcontainerConfigSchema = z.object({
  name: z.string().optional(),
  image: z.string().optional(),
  dockerFile: z.string().optional(),
  build: z.object({
    dockerfile: z.string().optional(),
    context: z.string().optional(),
    args: z.record(z.string()).optional(),
  }).optional(),
  features: z.record(z.any()).optional(),
  customizations: z.any().optional(),
  postCreateCommand: z.union([z.string(), z.array(z.string())]).optional(),
  mounts: z.array(z.any()).optional(),
  forwardPorts: z.array(z.number()).optional(),
  remoteUser: z.string().optional(),
});

export type DevcontainerConfig = z.infer<typeof DevcontainerConfigSchema>;

// Devcontainer CLI Log Schema
export const DevcontainerLogSchema = z.object({
  outcome: z.enum(["success", "error"]).optional(),
  message: z.string().optional(),
  description: z.string().optional(),
  timestamp: z.string().optional(),
  level: z.string().optional(),
  containerId: z.string().optional(),
  remoteUser: z.string().optional(),
  remoteWorkspaceFolder: z.string().optional(),
});

export type DevcontainerLog = z.infer<typeof DevcontainerLogSchema>;

// TodoWrite Tool Schema
export const TodoItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
  priority: z.enum(["high", "medium", "low"]),
});

export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema),
});

export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

// Validation helper functions
export function validateGeminiResponse(data: unknown): GeminiResponse | null {
  const result = GeminiResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

export function validatePlamoResponse(
  data: unknown,
): PlamoTranslationResponse | null {
  const result = PlamoTranslationResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

export function validateDevcontainerConfig(
  data: unknown,
): DevcontainerConfig | null {
  const result = DevcontainerConfigSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

export function validateDevcontainerLog(data: unknown): DevcontainerLog | null {
  const result = DevcontainerLogSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

export function validateTodoWriteInput(data: unknown): TodoWriteInput | null {
  const result = TodoWriteInputSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}
