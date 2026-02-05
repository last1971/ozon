export interface AIUsage {
    input_tokens: number;
    output_tokens: number;
}

export interface AIChatResponse {
    content: string;
    model: string;
    usage: AIUsage;
    finish_reason: string;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

export interface AIStreamChunk {
    content: string;
    done: boolean;
    usage?: AIUsage;
}
