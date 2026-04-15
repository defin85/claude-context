import * as path from "path";

function normalizeWslUncPath(inputPath: string): string {
    if (process.platform !== 'linux') {
        return inputPath;
    }

    const match = inputPath.match(/^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.*)$/i);
    if (!match) {
        return inputPath;
    }

    const [, distroName, rawPath] = match;
    const currentDistro = process.env.WSL_DISTRO_NAME;

    if (currentDistro && distroName.toLowerCase() !== currentDistro.toLowerCase()) {
        console.warn(
            `[PATH] Received WSL UNC path for distro '${distroName}', ` +
            `but current runtime is '${currentDistro}'. Attempting best-effort normalization.`
        );
    }

    const posixSegments = rawPath
        .split('\\')
        .filter(Boolean);

    return `/${posixSegments.join('/')}`;
}

/**
 * Truncate content to specified length
 */
export function truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
        return content;
    }
    return content.substring(0, maxLength) + '...';
}

export function normalizeCodebasePath(inputPath: string): string {
    const sanitizedPath = normalizeWslUncPath(inputPath.trim());
    return path.resolve(sanitizedPath);
}

/**
 * Ensure path is absolute. If relative path is provided, resolve it properly.
 */
export function ensureAbsolutePath(inputPath: string): string {
    return normalizeCodebasePath(inputPath);
}

export function trackCodebasePath(codebasePath: string): void {
    const absolutePath = normalizeCodebasePath(codebasePath);
    console.log(`[TRACKING] Tracked codebase path: ${absolutePath} (not marked as indexed)`);
}
