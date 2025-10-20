interface EventStreamMessage {
  headers: Record<string, any>;
  payload: Uint8Array;
  messageType: string;
  eventType: string;
  contentType: string;
}

const MIN_MESSAGE_SIZE = 16;
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16MB

export class RobustEventStreamParser {
  private buffer: Uint8Array = new Uint8Array(0);
  private errorCount = 0;
  private maxErrors = 100;

  setMaxErrors(maxErrors: number): void {
    this.maxErrors = maxErrors;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.errorCount = 0;
  }

  parseStream(data: Uint8Array): EventStreamMessage[] {
    this.buffer = this.concatBuffers(this.buffer, data);
    const messages: EventStreamMessage[] = [];

    while (this.buffer.length >= MIN_MESSAGE_SIZE) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
      const totalLength = view.getUint32(0, false); // Big-endian

      if (totalLength < MIN_MESSAGE_SIZE || totalLength > MAX_MESSAGE_SIZE) {
        this.buffer = this.buffer.slice(1);
        this.errorCount++;
        continue;
      }

      if (this.buffer.length < totalLength) {
        break;
      }

      const messageData = this.buffer.slice(0, totalLength);
      this.buffer = this.buffer.slice(totalLength);

      try {
        const message = this.parseSingleMessage(messageData);
        if (message) {
          messages.push(message);
        }
      } catch (err) {
        this.errorCount++;
        if (this.errorCount >= this.maxErrors) {
          throw new Error(`Too many errors (${this.errorCount}), stopping parse`);
        }
      }
    }

    return messages;
  }

  private parseSingleMessage(data: Uint8Array): EventStreamMessage | null {
    if (data.length < MIN_MESSAGE_SIZE) {
      return null;
    }

    const view = new DataView(data.buffer, data.byteOffset);
    const totalLength = view.getUint32(0, false);
    const headerLength = view.getUint32(4, false);

    if (totalLength !== data.length) {
      throw new Error(`Length mismatch: expected ${totalLength}, got ${data.length}`);
    }

    const headerData = data.slice(12, 12 + headerLength);
    const payloadStart = 12 + headerLength;
    const payloadEnd = totalLength - 4;
    const payloadData = data.slice(payloadStart, payloadEnd);

    const headers = this.parseHeaders(headerData);

    return {
      headers,
      payload: payloadData,
      messageType: this.getMessageType(headers),
      eventType: this.getEventType(headers),
      contentType: this.getContentType(headers),
    };
  }

  private parseHeaders(data: Uint8Array): Record<string, any> {
    const headers: Record<string, any> = {};
    
    if (data.length === 0) {
      return {
        ":message-type": "event",
        ":event-type": "assistantResponseEvent",
        ":content-type": "application/json",
      };
    }

    let offset = 0;
    const view = new DataView(data.buffer, data.byteOffset);

    while (offset < data.length) {
      if (offset + 1 > data.length) break;

      const nameLength = view.getUint8(offset);
      offset++;

      if (offset + nameLength > data.length) break;
      const nameBytes = data.slice(offset, offset + nameLength);
      const name = new TextDecoder().decode(nameBytes);
      offset += nameLength;

      if (offset + 1 > data.length) break;
      const valueType = view.getUint8(offset);
      offset++;

      if (offset + 2 > data.length) break;
      const valueLength = view.getUint16(offset, false);
      offset += 2;

      if (offset + valueLength > data.length) break;
      const valueBytes = data.slice(offset, offset + valueLength);
      offset += valueLength;

      headers[name] = this.parseHeaderValue(valueType, valueBytes);
    }

    return headers;
  }

  private parseHeaderValue(valueType: number, data: Uint8Array): any {
    const view = new DataView(data.buffer, data.byteOffset);

    switch (valueType) {
      case 0: // BOOL_TRUE
        return true;
      case 1: // BOOL_FALSE
        return false;
      case 2: // BYTE
        return view.getInt8(0);
      case 3: // SHORT
        return view.getInt16(0, false);
      case 4: // INTEGER
        return view.getInt32(0, false);
      case 5: // LONG
        return Number(view.getBigInt64(0, false));
      case 6: // BYTE_ARRAY
        return data;
      case 7: // STRING
        return new TextDecoder().decode(data);
      case 8: // TIMESTAMP
        return Number(view.getBigInt64(0, false));
      case 9: // UUID
        if (data.length === 16) {
          const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
          return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        }
        return new TextDecoder().decode(data);
      default:
        return data;
    }
  }

  private getMessageType(headers: Record<string, any>): string {
    return headers[":message-type"] || "event";
  }

  private getEventType(headers: Record<string, any>): string {
    return headers[":event-type"] || "";
  }

  private getContentType(headers: Record<string, any>): string {
    return headers[":content-type"] || "application/json";
  }

  private concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  }
}
