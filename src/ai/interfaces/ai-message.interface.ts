export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIContentPart {
    type: 'text' | 'image';
    text?: string;
    image_url?: { url: string };
}

export interface AICacheControl {
    type: 'ephemeral';
}

export interface AIChatMessage {
    role: AIMessageRole;
    content: string | AIContentPart[];
    cache_control?: AICacheControl;
}

export interface AIChatOptions {
    model?: string;
    max_tokens?: number;
    temperature?: number;
    stop_sequences?: string[];
    system?: string;
    web_search?: boolean;
}
