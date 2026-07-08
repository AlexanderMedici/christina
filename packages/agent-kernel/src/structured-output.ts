import type {
	JsonSchema,
	OutputContract,
	OutputValidationResult,
} from "./types";

function extractJson(text: string): unknown {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidates = [trimmed, fenced?.[1]?.trim()].filter(
		(value): value is string => Boolean(value),
	);
	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch {
			// Continue to bounded extraction.
		}
	}
	const objectStart = trimmed.indexOf("{");
	const objectEnd = trimmed.lastIndexOf("}");
	if (objectStart >= 0 && objectEnd > objectStart) {
		try {
			return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
		} catch {
			// Try array extraction below.
		}
	}
	const arrayStart = trimmed.indexOf("[");
	const arrayEnd = trimmed.lastIndexOf("]");
	if (arrayStart >= 0 && arrayEnd > arrayStart) {
		return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
	}
	throw new Error("No valid JSON value was found in the agent output.");
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSchema(
	value: unknown,
	schema: JsonSchema,
	path = "$",
): string[] {
	const errors: string[] = [];
	if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
		errors.push(`${path} must be one of the allowed enum values.`);
	}
	if (schema.type) {
		const validType =
			(schema.type === "null" && value === null) ||
			(schema.type === "array" && Array.isArray(value)) ||
			(schema.type === "object" && isObject(value)) ||
			(schema.type === "integer" && Number.isInteger(value)) ||
			(schema.type === "number" && typeof value === "number" && Number.isFinite(value)) ||
			(schema.type === "string" && typeof value === "string") ||
			(schema.type === "boolean" && typeof value === "boolean");
		if (!validType) {
			errors.push(`${path} must be of type ${schema.type}.`);
			return errors;
		}
	}
	if (typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			errors.push(`${path} must contain at least ${schema.minLength} characters.`);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			errors.push(`${path} must contain at most ${schema.maxLength} characters.`);
		}
	}
	if (typeof value === "number") {
		if (schema.minimum !== undefined && value < schema.minimum) {
			errors.push(`${path} must be at least ${schema.minimum}.`);
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			errors.push(`${path} must be at most ${schema.maximum}.`);
		}
	}
	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			errors.push(`${path} must contain at least ${schema.minItems} items.`);
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			errors.push(`${path} must contain at most ${schema.maxItems} items.`);
		}
		if (schema.items) {
			value.forEach((item, index) => {
				errors.push(...validateSchema(item, schema.items as JsonSchema, `${path}[${index}]`));
			});
		}
	}
	if (isObject(value)) {
		for (const required of schema.required ?? []) {
			if (!(required in value)) errors.push(`${path}.${required} is required.`);
		}
		for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
			if (key in value) {
				errors.push(...validateSchema(value[key], propertySchema, `${path}.${key}`));
			}
		}
		if (schema.additionalProperties === false && schema.properties) {
			for (const key of Object.keys(value)) {
				if (!(key in schema.properties)) {
					errors.push(`${path}.${key} is not an allowed property.`);
				}
			}
		}
	}
	return errors;
}

export function validateStructuredValue(
	value: unknown,
	contract: OutputContract | undefined,
	rawTextLength = 0,
): OutputValidationResult | undefined {
	if (!contract) return undefined;
	if (contract.format === "text") {
		const text = typeof value === "string" ? value : JSON.stringify(value);
		return { valid: true, format: "text", value: text, errors: [], rawTextLength };
	}
	const errors = contract.schema ? validateSchema(value, contract.schema) : [];
	return {
		valid: errors.length === 0,
		format: "json",
		value,
		errors,
		rawTextLength,
	};
}

export function validateOutput(
	text: string,
	contract: OutputContract | undefined,
): OutputValidationResult | undefined {
	if (!contract) return undefined;
	if (contract.format === "text") {
		return {
			valid: true,
			format: "text",
			value: text,
			errors: [],
			rawTextLength: text.length,
		};
	}
	try {
		const value = extractJson(text);
		const errors = contract.schema ? validateSchema(value, contract.schema) : [];
		return {
			valid: errors.length === 0,
			format: "json",
			value,
			errors,
			rawTextLength: text.length,
		};
	} catch (error) {
		return {
			valid: false,
			format: "json",
			errors: [error instanceof Error ? error.message : String(error)],
			rawTextLength: text.length,
		};
	}
}
