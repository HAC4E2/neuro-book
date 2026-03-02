import {z} from "zod";

export const AgentThreadKindSchema = z.enum(["leader", "subagent"]);
export const AgentThreadRunStatusSchema = z.enum(["idle", "running", "waiting_user", "completed", "stopped", "failed"]);
