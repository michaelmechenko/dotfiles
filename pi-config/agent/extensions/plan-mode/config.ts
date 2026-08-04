import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ModelSnapshot } from "./plan-state.ts";

export interface PlanModeConfig {
	executionModel: ModelSnapshot;
}

const DEFAULT_CONFIG: PlanModeConfig = {
	executionModel: {
		provider: "opencode",
		model: "gpt-5.6-luna",
		thinkingLevel: "medium",
	},
};

export function loadPlanModeConfig(): PlanModeConfig {
	const path = join(getAgentDir(), "plan-mode.json");
	if (!existsSync(path)) return DEFAULT_CONFIG;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PlanModeConfig>;
		const executionModel = parsed.executionModel;
		if (
			!executionModel ||
			typeof executionModel.provider !== "string" ||
			typeof executionModel.model !== "string" ||
			typeof executionModel.thinkingLevel !== "string"
		) {
			return DEFAULT_CONFIG;
		}
		return { executionModel: executionModel as ModelSnapshot };
	} catch {
		return DEFAULT_CONFIG;
	}
}
