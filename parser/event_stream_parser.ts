/**
 * EventStream 解析器
 * 解析 AWS CodeWhisperer 的 BigEndian 格式 EventStream
 */

import type { CodeWhispererStreamEvent } from "../types.ts";
import * as logger from "../logger.ts";

// ============================================================================
// EventStream 消息结构
// ============================================================================

interface EventStreamMessage {
  headers: Map<string, HeaderValue>;
  payload: Uint8Array;
}

interface HeaderValue {
  type: number;
  value: string | number | Uint8Array | boolean;
}

// ============================================================================
// EventStream 解析器
// ============================================================================

export class EventStreamParser {
  private buffer: Uint8Array = new Uint8Array(0);

  /**
   * 解析数据块
   */
  parse(chunk: Uint8Array): EventStreamMessage[] {
    // 追加到缓冲区
    this.buffer = this.appendBuffer(this.buffer, chunk);

    const messages: EventStreamMessage[] = [];

    while (this.buffer.length >= 12) {
      // 至少需要 12 字节（prelude）
      // 读取消息长度（前 4 字节，BigEndian）
      const totalLength = this.readUint32BE(this.buffer, 0);

      // 检查是否有完整消息
      if (this.buffer.length < totalLength) {
        break;
      }

      // 提取消息
      const messageBytes = this.buffer.slice(0, totalLength);
      this.buffer = this.buffer.slice(totalLength);

      // 解析消息
      try {
        const message = this.parseMessage(messageBytes);
        messages.push(message);
      } catch (error) {
        logger.error("解析 EventStream 消息失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return messages;
  }

  /**
   * 解析单个消息
   */
  private parseMessage(bytes: Uint8Array): EventStreamMessage {
    // 消息结构：
    // - 4 bytes: total length (BigEndian)
    // - 4 bytes: headers length (BigEndian)
    // - 4 bytes: prelude CRC (BigEndian)
    // - N bytes: headers
    // - M bytes: payload
    // - 4 bytes: message CRC (BigEndian)

    const totalLength = this.readUint32BE(bytes, 0);
    const headersLength = this.readUint32BE(bytes, 4);
    // const preludeCRC = this.readUint32BE(bytes, 8);

    const headersStart = 12;
    const headersEnd = headersStart + headersLength;
    const payloadStart = headersEnd;
    const payloadEnd = totalLength - 4; // 减去 message CRC

    // 解析 headers
    const headersBytes = bytes.slice(headersStart, headersEnd);
    const headers = this.parseHeaders(headersBytes);

    // 提取 payload
    const payload = bytes.slice(payloadStart, payloadEnd);

    return { headers, payload };
  }

  /**
   * 解析 headers
   */
  private parseHeaders(bytes: Uint8Array): Map<string, HeaderValue> {
    const headers = new Map<string, HeaderValue>();
    let offset = 0;

    while (offset < bytes.length) {
      // 读取 header name length (1 byte)
      const nameLength = bytes[offset];
      offset += 1;

      // 读取 header name
      const name = new TextDecoder().decode(
        bytes.slice(offset, offset + nameLength),
      );
      offset += nameLength;

      // 读取 header value type (1 byte)
      const valueType = bytes[offset];
      offset += 1;

      // 读取 header value
      let value: string | number | Uint8Array | boolean;

      switch (valueType) {
        case 0: // true
          value = true;
          break;
        case 1: // false
          value = false;
          break;
        case 2: // byte
          value = bytes[offset];
          offset += 1;
          break;
        case 3: // short (2 bytes, BigEndian)
          value = this.readUint16BE(bytes, offset);
          offset += 2;
          break;
        case 4: // integer (4 bytes, BigEndian)
          value = this.readUint32BE(bytes, offset);
          offset += 4;
          break;
        case 5: // long (8 bytes, BigEndian)
          value = this.readUint64BE(bytes, offset);
          offset += 8;
          break;
        case 6: // byte array
          {
            const length = this.readUint16BE(bytes, offset);
            offset += 2;
            value = bytes.slice(offset, offset + length);
            offset += length;
          }
          break;
        case 7: // string
          {
            const length = this.readUint16BE(bytes, offset);
            offset += 2;
            value = new TextDecoder().decode(
              bytes.slice(offset, offset + length),
            );
            offset += length;
          }
          break;
        case 8: // timestamp (8 bytes, BigEndian)
          value = this.readUint64BE(bytes, offset);
          offset += 8;
          break;
        case 9: // uuid (16 bytes)
          value = bytes.slice(offset, offset + 16);
          offset += 16;
          break;
        default:
          throw new Error(`未知的 header value type: ${valueType}`);
      }

      headers.set(name, { type: valueType, value });
    }

    return headers;
  }

  /**
   * 追加缓冲区
   */
  private appendBuffer(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }

  /**
   * 读取 32 位无符号整数（BigEndian）
   */
  private readUint32BE(bytes: Uint8Array, offset: number): number {
    return (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    );
  }

  /**
   * 读取 16 位无符号整数（BigEndian）
   */
  private readUint16BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  /**
   * 读取 64 位无符号整数（BigEndian）
   */
  private readUint64BE(bytes: Uint8Array, offset: number): number {
    // JavaScript 的 Number 类型只能安全表示 53 位整数
    // 这里简化处理，只读取低 32 位
    const high = this.readUint32BE(bytes, offset);
    const low = this.readUint32BE(bytes, offset + 4);
    return high * 0x100000000 + low;
  }
}

/**
 * 解析 EventStream 消息为 CodeWhisperer 事件
 */
export function parseCodeWhispererEvent(
  message: EventStreamMessage,
): CodeWhispererStreamEvent | null {
  const eventType = message.headers.get(":event-type")?.value as
    | string
    | undefined;

  if (!eventType) {
    return null;
  }

  // 解析 payload
  const payloadText = new TextDecoder().decode(message.payload);

  try {
    const payload = payloadText ? JSON.parse(payloadText) : {};

    switch (eventType) {
      case "messageMetadata":
        return {
          messageMetadataEvent: payload,
        };
      case "assistantResponseEvent":
        return {
          assistantResponseEvent: payload,
        };
      case "codeReferenceEvent":
        return {
          codeReferenceEvent: payload,
        };
      case "supplementaryWebLinksEvent":
        return {
          supplementaryWebLinksEvent: payload,
        };
      case "followupPromptEvent":
        return {
          followupPromptEvent: payload,
        };
      case "error":
        return {
          error: payload,
        };
      default:
        logger.debug("未知的事件类型", { event_type: eventType });
        return null;
    }
  } catch (error) {
    logger.error("解析事件 payload 失败", {
      event_type: eventType,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
