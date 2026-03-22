export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    module?: string;
    traceId?: string;
    meta?: Record<string, any>;
}

export interface Transport {
    write(entry: LogEntry): void;
}

export interface TransportOptions {
    level?: LogLevel;
}
