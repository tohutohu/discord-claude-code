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

// Claude CLI Stream Output Schemas
export const ClaudeSessionMessageSchema = z.object({
  type: z.literal("session"),
  session_id: z.string(),
});

export const ClaudeAssistantMessageSchema = z.object({
  type: z.literal("assistant"),
  session_id: z.string(),
  role: z.literal("assistant"),
  model: z.string(),
  content: z.array(z.union([
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }),
    z.object({
      type: z.literal("tool_use"),
      id: z.string(),
      name: z.string(),
      input: z.record(z.unknown()),
    }),
    z.object({
      type: z.literal("tool_result"),
      tool_use_id: z.string(),
      content: z.string(),
      is_error: z.boolean().optional(),
    }),
  ])),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }).optional(),
});

export const ClaudeResultMessageSchema = z.object({
  type: z.literal("result"),
  session_id: z.string(),
  result: z.object({
    type: z.enum(["assistant", "session"]),
    role: z.string().optional(),
    model: z.string().optional(),
    content: z.any().optional(),
    usage: z.any().optional(),
  }),
});

export const ClaudeErrorMessageSchema = z.object({
  type: z.literal("error"),
  session_id: z.string().optional(),
  error: z.union([
    z.string(),
    z.object({
      type: z.string(),
      message: z.string(),
    }),
  ]),
});

export const ClaudeStreamMessageSchema = z.union([
  ClaudeSessionMessageSchema,
  ClaudeAssistantMessageSchema,
  ClaudeResultMessageSchema,
  ClaudeErrorMessageSchema,
]);

export type ClaudeStreamMessage = z.infer<typeof ClaudeStreamMessageSchema>;

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
export function validateClaudeStreamMessage(
  data: unknown,
): ClaudeStreamMessage | null {
  const result = ClaudeStreamMessageSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return null;
}

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
