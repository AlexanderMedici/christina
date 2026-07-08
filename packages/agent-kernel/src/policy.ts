import { isAbsolute, relative, resolve } from "node:path";
import type { PolicyDecision, PolicyOperation } from "./types";

const DESTRUCTIVE_COMMAND =
	/(^|\s)(rm\s+-rf|rmdir\s+\/s|del\s+\/f|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|drop\s+(database|table)|format\s+[a-z]:|shutdown|reboot)(\s|$)/i;
const PUBLISH_COMMAND =
	/(^|\s)(git\s+push|npm\s+publish|bun\s+publish|docker\s+push|gh\s+release)(\s|$)/i;
const CREDENTIAL_COMMAND =
	/(^|\s)(security\s+find-generic-password|cmdkey|credential|keychain|\.env)(\s|$)/i;

export interface PolicyEngine {
	evaluate(operation: PolicyOperation, workspaceRoot: string): PolicyDecision;
}

function isInsideWorkspace(target: string, workspaceRoot: string): boolean {
	const absoluteTarget = isAbsolute(target)
		? resolve(target)
		: resolve(workspaceRoot, target);
	const rel = relative(resolve(workspaceRoot), absoluteTarget);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class DefaultPolicyEngine implements PolicyEngine {
	evaluate(operation: PolicyOperation, workspaceRoot: string): PolicyDecision {
		if (operation.safetyMode === "review") {
			if (operation.category === "filesystem.read") {
				if (
					operation.target &&
					!isInsideWorkspace(operation.target, workspaceRoot)
				) {
					return {
						result: "deny",
						reason: "Review mode cannot read outside the workspace.",
						ruleId: "review.workspace-boundary",
						riskLevel: "high",
					};
				}
				return {
					result: "allow",
					reason: "Read-only access inside the workspace is allowed.",
					ruleId: "review.read",
					riskLevel: "low",
				};
			}
			return {
				result: "deny",
				reason: "Review mode permits inspection only.",
				ruleId: "review.read-only",
				riskLevel: "high",
			};
		}

		if (
			operation.target &&
			operation.category.startsWith("filesystem.") &&
			!isInsideWorkspace(operation.target, workspaceRoot)
		) {
			return {
				result:
					operation.safetyMode === "unrestricted" ? "require_approval" : "deny",
				reason: "The target is outside the active workspace.",
				ruleId: "workspace.boundary",
				riskLevel: "critical",
			};
		}

		if (
			operation.category === "credential.read" ||
			operation.category === "credential.write"
		) {
			return {
				result:
					operation.safetyMode === "unrestricted" ? "require_approval" : "deny",
				reason: "Credential access is isolated from ordinary agent runs.",
				ruleId: "credentials.isolation",
				riskLevel: "critical",
			};
		}

		if (
			operation.category === "git.push" ||
			operation.category === "package.publish" ||
			operation.category === "external.message" ||
			operation.category === "checkpoint.restore" ||
			operation.category === "filesystem.delete"
		) {
			return {
				result: "require_approval",
				reason:
					"This action is destructive or visible outside the local workspace.",
				ruleId: "approval.high-impact",
				riskLevel: "high",
			};
		}

		if (operation.category === "command.run" && operation.command) {
			if (DESTRUCTIVE_COMMAND.test(operation.command)) {
				return {
					result: "require_approval",
					reason: "The command appears destructive.",
					ruleId: "command.destructive",
					riskLevel: "critical",
				};
			}
			if (PUBLISH_COMMAND.test(operation.command)) {
				return {
					result: "require_approval",
					reason: "The command publishes or pushes externally.",
					ruleId: "command.publish",
					riskLevel: "high",
				};
			}
			if (CREDENTIAL_COMMAND.test(operation.command)) {
				return {
					result: "deny",
					reason: "Commands may not directly inspect credential stores.",
					ruleId: "command.credentials",
					riskLevel: "critical",
				};
			}
		}

		return {
			result: "allow",
			reason: "The action is local, workspace-scoped, and reversible.",
			ruleId: "workspace.local-reversible",
			riskLevel: "low",
		};
	}
}
