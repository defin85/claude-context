// Interface definitions
export interface CodeChunk {
    content: string;
    metadata: {
        startLine: number;
        endLine: number;
        language?: string;
        filePath?: string;
        documentId?: string;
        chunkIndex?: number;
        duplicateOrdinal?: number;
        bsl?: Record<string, unknown>;
    };
}

// Splitter type enumeration
export enum SplitterType {
    LANGCHAIN = 'langchain',
    AST = 'ast'
}

// Splitter configuration interface
export interface SplitterConfig {
    type?: SplitterType;
    chunkSize?: number;
    chunkOverlap?: number;
}

export interface Splitter {
    /**
     * Split code into code chunks
     * @param code Code content
     * @param language Programming language
     * @param filePath File path
     * @returns Array of code chunks
     */
    split(code: string, language: string, filePath?: string): Promise<CodeChunk[]>;

    /**
     * Set chunk size
     * @param chunkSize Chunk size
     */
    setChunkSize(chunkSize: number): void;

    /**
     * Set chunk overlap size
     * @param chunkOverlap Chunk overlap size
     */
    setChunkOverlap(chunkOverlap: number): void;
}

// Implementation class exports
export * from './langchain-splitter';

export class AstCodeSplitter implements Splitter {
    private implementation?: Splitter;
    private chunkSize?: number;
    private chunkOverlap?: number;

    constructor(chunkSize?: number, chunkOverlap?: number) {
        this.chunkSize = chunkSize;
        this.chunkOverlap = chunkOverlap;
    }

    private getImplementation(): Splitter {
        if (this.implementation) {
            return this.implementation;
        }

        const { AstCodeSplitter: NativeAstCodeSplitter } = require('./ast-splitter');
        const implementation = new NativeAstCodeSplitter(this.chunkSize, this.chunkOverlap);
        this.implementation = implementation;
        return implementation;
    }

    async split(code: string, language: string, filePath?: string): Promise<CodeChunk[]> {
        return this.getImplementation().split(code, language, filePath);
    }

    setChunkSize(chunkSize: number): void {
        this.chunkSize = chunkSize;
        this.implementation?.setChunkSize(chunkSize);
    }

    setChunkOverlap(chunkOverlap: number): void {
        this.chunkOverlap = chunkOverlap;
        this.implementation?.setChunkOverlap(chunkOverlap);
    }

    static getSupportedLanguages(): string[] {
        const { AstCodeSplitter: NativeAstCodeSplitter } = require('./ast-splitter');
        return NativeAstCodeSplitter.getSupportedLanguages();
    }

    static isLanguageSupported(language: string): boolean {
        const { AstCodeSplitter: NativeAstCodeSplitter } = require('./ast-splitter');
        return NativeAstCodeSplitter.isLanguageSupported(language);
    }
}
