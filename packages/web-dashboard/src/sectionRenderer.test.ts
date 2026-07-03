import assert from 'node:assert/strict';
import test from 'node:test';
import { createSectionRenderer, SectionHost } from './sectionRenderer';

test('section renderer skips unchanged fingerprints', () => {
    const sections = new Map<string, SectionHost>([
        ['results', { innerHTML: '' }],
    ]);
    const renderer = createSectionRenderer((id) => sections.get(id) || null);
    const host = sections.get('results');

    assert.equal(renderer.renderSection('results', 'same', '<p>one</p>'), true);
    assert.equal(host?.innerHTML, '<p>one</p>');
    assert.equal(renderer.renderSection('results', 'same', '<p>ignored</p>'), false);
    assert.equal(host?.innerHTML, '<p>one</p>');
});

test('section renderer updates changed sections independently', () => {
    const sections = new Map<string, SectionHost>([
        ['metrics', { innerHTML: '' }],
        ['results', { innerHTML: '<pre>selected text</pre>' }],
    ]);
    const renderer = createSectionRenderer((id) => sections.get(id) || null);

    renderer.renderSection('results', 'results-v1', '<pre>selected text</pre>');
    assert.equal(renderer.renderSection('metrics', 'metrics-v1', '<strong>1</strong>'), true);
    assert.equal(sections.get('results')?.innerHTML, '<pre>selected text</pre>');
    assert.equal(renderer.renderSection('results', 'results-v1', '<pre>changed controls only</pre>'), false);
    assert.equal(sections.get('results')?.innerHTML, '<pre>selected text</pre>');
});

test('section renderer can isolate selectable text from busy controls', () => {
    const sections = new Map<string, SectionHost>([
        ['toolbar-text', { innerHTML: '<p>/repo/demo</p>' }],
        ['toolbar-actions', { innerHTML: '<button>Индексировать</button>' }],
    ]);
    const renderer = createSectionRenderer((id) => sections.get(id) || null);

    renderer.renderSection('toolbar-text', 'path:/repo/demo', '<p>/repo/demo</p>');
    renderer.renderSection('toolbar-actions', 'busy:false', '<button>Индексировать</button>');
    assert.equal(renderer.renderSection('toolbar-actions', 'busy:true', '<button disabled>Индексировать</button>'), true);
    assert.equal(sections.get('toolbar-text')?.innerHTML, '<p>/repo/demo</p>');
});

test('section renderer keeps toolbar path stable when polling metadata changes', () => {
    const sections = new Map<string, SectionHost>([
        ['toolbar-path', { innerHTML: '' }],
        ['toolbar-meta', { innerHTML: '' }],
    ]);
    const renderer = createSectionRenderer((id) => sections.get(id) || null);

    renderer.renderSection('toolbar-path', 'path:/repo/demo', '<p>/repo/demo</p>');
    renderer.renderSection('toolbar-meta', 'retrieval:v1', '<p>hybrid / quality</p>');

    assert.equal(renderer.renderSection('toolbar-meta', 'retrieval:v2', '<p>hybrid / fast</p>'), true);
    assert.equal(sections.get('toolbar-path')?.innerHTML, '<p>/repo/demo</p>');
});

test('section renderer keeps operation job paths stable when progress and controls change', () => {
    const sections = new Map<string, SectionHost>([
        ['active-jobs', { innerHTML: '' }],
        ['selected-progress', { innerHTML: '' }],
        ['toolbar-actions', { innerHTML: '' }],
    ]);
    const renderer = createSectionRenderer((id) => sections.get(id) || null);

    renderer.renderSection('active-jobs', 'jobs:/repo/demo', '<span>/repo/demo</span>');
    renderer.renderSection('selected-progress', 'progress:10', '<strong>10%</strong>');
    renderer.renderSection('toolbar-actions', 'busy:false', '<button>Отменить</button>');

    assert.equal(renderer.renderSection('selected-progress', 'progress:20', '<strong>20%</strong>'), true);
    assert.equal(renderer.renderSection('toolbar-actions', 'busy:true', '<button disabled>Отменить</button>'), true);
    assert.equal(sections.get('active-jobs')?.innerHTML, '<span>/repo/demo</span>');
});
