export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

export class AttributeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttributeError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class MediaTypeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaTypeError";
  }
}

export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

export class OtherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtherError";
  }
}
