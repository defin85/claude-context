export interface SectionHost {
    innerHTML: string;
}

export type SectionLookup = (id: string) => SectionHost | null;

export function createSectionRenderer(lookup: SectionLookup) {
    const fingerprints = new Map<string, string>();

    return {
        renderSection(id: string, fingerprint: string, html: string): boolean {
            if (fingerprints.get(id) === fingerprint) {
                return false;
            }

            const host = lookup(id);
            if (!host) {
                throw new Error(`Dashboard section not found: ${id}`);
            }

            host.innerHTML = html;
            fingerprints.set(id, fingerprint);
            return true;
        },
        clear(): void {
            fingerprints.clear();
        },
    };
}

