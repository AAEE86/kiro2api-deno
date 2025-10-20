import * as logger from "../logger/logger.ts";

// Validate and process OpenAI tools
export function validateAndProcessTools(tools: any[]): any[] {
  if (!tools || tools.length === 0) {
    return [];
  }

  const validTools: any[] = [];
  const validationErrors: string[] = [];

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];

    if (tool.type !== "function") {
      validationErrors.push(`tool[${i}]: Unsupported tool type '${tool.type}', only 'function' is supported`);
      continue;
    }

    if (!tool.function?.name) {
      validationErrors.push(`tool[${i}]: Function name cannot be empty`);
      continue;
    }

    // Filter unsupported tools: web_search
    if (tool.function.name === "web_search" || tool.function.name === "websearch") {
      continue;
    }

    if (!tool.function.parameters) {
      validationErrors.push(`tool[${i}]: Parameters schema cannot be empty`);
      continue;
    }

    // Clean and validate parameters
    try {
      const cleanedParams = cleanAndValidateToolParameters(tool.function.parameters);

      validTools.push({
        name: tool.function.name,
        description: tool.function.description || "",
        input_schema: cleanedParams,
      });
    } catch (err) {
      validationErrors.push(`tool[${i}] (${tool.function.name}): ${err.message}`);
    }
  }

  if (validationErrors.length > 0) {
    logger.warn("Tool validation errors", logger.String("errors", validationErrors.join("; ")));
  }

  return validTools;
}

// Clean and validate tool parameters
export function cleanAndValidateToolParameters(params: Record<string, any>): Record<string, any> {
  if (!params || typeof params !== "object") {
    throw new Error("Parameters cannot be null or non-object");
  }

  // Deep copy to avoid modifying original data
  const cleaned = JSON.parse(JSON.stringify(params));

  // Remove unsupported top-level fields
  delete cleaned.additionalProperties;
  delete cleaned.strict;
  delete cleaned.$schema;
  delete cleaned.$id;
  delete cleaned.$ref;
  delete cleaned.definitions;
  delete cleaned.$defs;

  // Handle long parameter names - CodeWhisperer limits parameter name length
  if (cleaned.properties && typeof cleaned.properties === "object") {
    const cleanedProperties: Record<string, any> = {};
    for (const [paramName, paramDef] of Object.entries(cleaned.properties)) {
      let cleanedName = paramName;
      // If parameter name exceeds 64 characters, simplify it
      if (paramName.length > 64) {
        if (paramName.length > 80) {
          cleanedName = paramName.substring(0, 20) + "_" + paramName.substring(paramName.length - 20);
        } else {
          cleanedName = paramName.substring(0, 30) + "_param";
        }
      }
      cleanedProperties[cleanedName] = paramDef;
    }
    cleaned.properties = cleanedProperties;

    // Update required field with cleaned parameter names
    if (cleaned.required && Array.isArray(cleaned.required)) {
      const cleanedRequired: string[] = [];
      for (const req of cleaned.required) {
        if (typeof req === "string") {
          let cleanedReq = req;
          if (req.length > 64) {
            if (req.length > 80) {
              cleanedReq = req.substring(0, 20) + "_" + req.substring(req.length - 20);
            } else {
              cleanedReq = req.substring(0, 30) + "_param";
            }
          }
          cleanedRequired.push(cleanedReq);
        }
      }
      cleaned.required = cleanedRequired;
    }
  }

  // Ensure schema explicitly declares top-level type=object
  if (!cleaned.type) {
    cleaned.type = "object";
  }

  // Validate required fields
  if (cleaned.type === "object") {
    if (!cleaned.properties) {
      throw new Error("Object type missing properties field");
    }
  }

  // CodeWhisperer schema compatibility handling
  if (cleaned.required !== undefined && cleaned.required !== null) {
    if (Array.isArray(cleaned.required)) {
      const validRequired: string[] = [];
      for (const v of cleaned.required) {
        if (typeof v === "string" && v !== "") {
          validRequired.push(v);
        }
      }
      cleaned.required = validRequired;
    } else {
      delete cleaned.required;
    }
  }

  if (cleaned.properties !== undefined) {
    if (typeof cleaned.properties !== "object" || cleaned.properties === null) {
      delete cleaned.properties;
      cleaned.properties = {};
    }
  } else {
    cleaned.properties = {};
  }

  return cleaned;
}

// Convert OpenAI tool_choice to Anthropic format
export function convertOpenAIToolChoiceToAnthropic(openaiToolChoice: any): any {
  if (!openaiToolChoice) {
    return undefined;
  }

  // Handle string type: "auto", "none", "required"
  if (typeof openaiToolChoice === "string") {
    switch (openaiToolChoice) {
      case "auto":
        return { type: "auto" };
      case "required":
      case "any":
        return { type: "any" };
      case "none":
        // Anthropic doesn't have "none" option
        return undefined;
      default:
        return { type: "auto" };
    }
  }

  // Handle object type: {type: "function", function: {name: "tool_name"}}
  if (typeof openaiToolChoice === "object") {
    if (openaiToolChoice.type === "function" && openaiToolChoice.function?.name) {
      return {
        type: "tool",
        name: openaiToolChoice.function.name,
      };
    }
  }

  return { type: "auto" };
}
