import { createRequire } from "node:module";
import path from "node:path";
import { AstCodeSplitter } from "../packages/core/src/splitter/ast-splitter";

type LanguageCase = {
    language: string;
    fileName: string;
    parserModule: string;
    parserExport?: string;
    code: string;
    expected: string;
};

const coreRequire = createRequire(
    path.resolve(__dirname, "../packages/core/package.json"),
);

const cases: LanguageCase[] = [
    {
        language: "javascript",
        fileName: "sample.js",
        parserModule: "tree-sitter-javascript",
        code: "export function alpha() {\n  return 1;\n}\n",
        expected: "alpha",
    },
    {
        language: "typescript",
        fileName: "sample.ts",
        parserModule: "tree-sitter-typescript",
        parserExport: "typescript",
        code: "export interface User { id: string }\nexport function alpha(user: User): string {\n  return user.id;\n}\n",
        expected: "alpha",
    },
    {
        language: "python",
        fileName: "sample.py",
        parserModule: "tree-sitter-python",
        code: "def alpha():\n    return 1\n",
        expected: "alpha",
    },
    {
        language: "java",
        fileName: "Sample.java",
        parserModule: "tree-sitter-java",
        code: "class Sample {\n  int alpha() { return 1; }\n}\n",
        expected: "alpha",
    },
    {
        language: "cpp",
        fileName: "sample.cpp",
        parserModule: "tree-sitter-cpp",
        code: "int alpha() {\n  return 1;\n}\n",
        expected: "alpha",
    },
    {
        language: "c",
        fileName: "sample.c",
        parserModule: "tree-sitter-cpp",
        code: "int alpha(void) {\n  return 1;\n}\n",
        expected: "alpha",
    },
    {
        language: "go",
        fileName: "sample.go",
        parserModule: "tree-sitter-go",
        code: "package main\n\nfunc alpha() int {\n  return 1\n}\n",
        expected: "alpha",
    },
    {
        language: "rust",
        fileName: "sample.rs",
        parserModule: "tree-sitter-rust",
        code: "fn alpha() -> i32 {\n    1\n}\n",
        expected: "alpha",
    },
    {
        language: "csharp",
        fileName: "Sample.cs",
        parserModule: "tree-sitter-c-sharp",
        code: "class Sample {\n  int Alpha() { return 1; }\n}\n",
        expected: "Alpha",
    },
    {
        language: "scala",
        fileName: "Sample.scala",
        parserModule: "tree-sitter-scala",
        code: "class Sample {\n  def alpha(): Int = 1\n}\n",
        expected: "alpha",
    },
    {
        language: "bsl",
        fileName: "Sample.bsl",
        parserModule: "tree-sitter-bsl",
        code: "Перем ГлобальнаяПеременная;\n\nПроцедура Альфа()\n    ГлобальнаяПеременная = 1;\nКонецПроцедуры\n\nФункция Бета()\n    Возврат ГлобальнаяПеременная;\nКонецФункции\n",
        expected: "Альфа",
    },
];

function loadLanguage(testCase: LanguageCase): unknown {
    const parserModule = coreRequire(testCase.parserModule);
    return testCase.parserExport
        ? parserModule[testCase.parserExport]
        : parserModule;
}

async function main(): Promise<void> {
    const Parser = coreRequire("tree-sitter");
    const splitter = new AstCodeSplitter(4000, 0);
    const failures: string[] = [];

    for (const testCase of cases) {
        try {
            const parser = new Parser();
            parser.setLanguage(loadLanguage(testCase));
        } catch (error) {
            failures.push(
                `${testCase.language}: Parser.setLanguage failed: ${error}`,
            );
            continue;
        }

        const warnings: string[] = [];
        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
            warnings.push(args.map(String).join(" "));
        };

        let chunks;
        try {
            chunks = await splitter.split(
                testCase.code,
                testCase.language,
                testCase.fileName,
            );
        } catch (error) {
            failures.push(`${testCase.language}: split failed: ${error}`);
            console.warn = originalWarn;
            continue;
        }
        console.warn = originalWarn;

        const fallbackWarnings = warnings.filter((warning) =>
            warning.includes("falling back to LangChain"),
        );
        if (fallbackWarnings.length > 0) {
            failures.push(
                `${testCase.language}: unexpected LangChain fallback: ${fallbackWarnings.join(" | ")}`,
            );
        }

        if (!chunks || chunks.length === 0) {
            failures.push(`${testCase.language}: no chunks produced`);
            continue;
        }

        const combined = chunks.map((chunk) => chunk.content).join("\n");
        if (!combined.includes(testCase.expected)) {
            failures.push(
                `${testCase.language}: expected chunk content to include ${testCase.expected}`,
            );
        }
    }

    if (failures.length > 0) {
        console.error("AST splitter regression failed:");
        for (const failure of failures) {
            console.error(`- ${failure}`);
        }
        process.exit(1);
    }

    console.log(`AST splitter regression passed for ${cases.length} cases.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
