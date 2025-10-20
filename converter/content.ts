import * as logger from "../logger/logger.ts";

// Process message content to extract text and images
export function processMessageContent(content: any): {
  text: string;
  images: any[];
  toolResults: any[];
} {
  const textParts: string[] = [];
  const images: any[] = [];
  const toolResults: any[] = [];

  if (typeof content === "string") {
    return { text: content, images: [], toolResults: [] };
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === "object" && block !== null) {
        const blockType = block.type;

        switch (blockType) {
          case "text":
            if (typeof block.text === "string") {
              textParts.push(block.text);
            }
            break;

          case "image":
            if (block.source) {
              const format = block.source.media_type?.split("/")[1] || "png";
              images.push({
                format,
                source: {
                  bytes: block.source.data,
                },
              });
            }
            break;

          case "tool_result":
            // Extract tool results
            if (block.tool_use_id) {
              let contentArray: any[] = [];

              if (block.content !== undefined && block.content !== null) {
                if (typeof block.content === "string") {
                  contentArray = [{ text: block.content }];
                } else if (Array.isArray(block.content)) {
                  for (const item of block.content) {
                    if (typeof item === "string") {
                      contentArray.push({ text: item });
                    } else if (typeof item === "object" && item !== null) {
                      contentArray.push(item);
                    }
                  }
                } else if (typeof block.content === "object") {
                  contentArray = [block.content];
                } else {
                  contentArray = [{ text: String(block.content) }];
                }
              }

              if (contentArray.length === 0) {
                contentArray = [{ text: "" }];
              }

              toolResults.push({
                toolUseId: block.tool_use_id,
                content: contentArray,
                status: block.is_error ? "error" : "success",
                isError: block.is_error || false,
              });
            }
            break;
        }
      }
    }
  }

  return {
    text: textParts.join(""),
    images,
    toolResults,
  };
}

// Validate image content
export function validateImageContent(source: any): boolean {
  if (!source || typeof source !== "object") {
    return false;
  }

  if (!source.type || source.type !== "base64") {
    return false;
  }

  if (!source.media_type || !source.media_type.startsWith("image/")) {
    return false;
  }

  if (!source.data || typeof source.data !== "string") {
    return false;
  }

  return true;
}

// Parse tool result content
export function parseToolResultContent(content: any): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        textParts.push(item);
      } else if (typeof item === "object" && item !== null) {
        if (item.text && typeof item.text === "string") {
          textParts.push(item.text);
        } else {
          textParts.push(JSON.stringify(item));
        }
      }
    }
    return textParts.join("\n");
  }

  if (typeof content === "object" && content !== null) {
    if (content.text && typeof content.text === "string") {
      return content.text;
    }
    return JSON.stringify(content);
  }

  return String(content);
}
