import { buildClaudePrompt, buildConventions, buildHistorySection } from './prompt-template';
import type { HistoryTurn } from './agent-service.interface';

describe('buildHistorySection', () => {
  it('is null with no prior turns - nothing to add to the prompt', () => {
    expect(buildHistorySection([])).toBeNull();
  });

  it('includes every turn verbatim (prompt + reply) when the conversation is short', () => {
    const history: HistoryTurn[] = [
      { prompt: 'Add a pricing section', summary: 'Added a pricing section with three tiers.' },
      { prompt: 'What framework does this use?' }, // no summary - e.g. an older turn from before this feature
    ];
    const section = buildHistorySection(history);
    expect(section).toContain('You: Add a pricing section');
    expect(section).toContain('You replied: Added a pricing section with three tiers.');
    expect(section).toContain('You: What framework does this use?');
    expect(section).not.toContain('You replied:\n'); // no dangling "You replied:" for the summary-less turn
  });

  it('compacts older turns to one-line bullets once the full history would be too large, keeping recent turns verbatim', () => {
    // Long enough prompts/summaries that the full verbatim history clearly
    // blows the character budget, forcing compaction.
    const longPrompt = 'Please make a substantial change: '.repeat(20);
    const longSummary = 'Here is a very long description of what I did: '.repeat(20);
    const history: HistoryTurn[] = Array.from({ length: 10 }, (_, i) => ({
      prompt: `${longPrompt} (turn ${i})`,
      summary: `${longSummary} (turn ${i})`,
    }));

    const section = buildHistorySection(history)!;

    // The oldest turn should be compacted to a truncated one-line bullet,
    // not appear with its full (untruncated) text.
    expect(section).not.toContain(`${longPrompt} (turn 0)`);
    expect(section).toContain('- You:');
    // Compaction (or the final size truncation) actually shrank things -
    // nowhere near the ~10,900 chars ten full verbatim turns would be.
    expect(section.length).toBeLessThan(6000);
  });

  it('never exceeds a sane hard size cap even in pathological cases (e.g. one enormous turn)', () => {
    const history: HistoryTurn[] = [
      { prompt: 'x'.repeat(50_000), summary: 'y'.repeat(50_000) },
    ];
    const section = buildHistorySection(history)!;
    // Generous upper bound - proves truncation actually kicks in rather
    // than ever forwarding an unbounded blob to the model.
    expect(section.length).toBeLessThan(10_000);
  });
});

describe('buildConventions', () => {
  it('includes the conversation rule and the history section for both site types', () => {
    const history: HistoryTurn[] = [{ prompt: 'Hi', summary: 'Hello!' }];

    const staticConventions = buildConventions([], 'static', history);
    expect(staticConventions).toContain('Conversation:');
    expect(staticConventions).toContain('Conversation so far');
    expect(staticConventions).toContain('You: Hi');

    const dynamicConventions = buildConventions([], 'dynamic', history);
    expect(dynamicConventions).toContain('Conversation:');
    expect(dynamicConventions).toContain('Conversation so far');
  });

  it('omits the history section entirely for a brand-new project with no prior turns', () => {
    const conventions = buildConventions([], 'static', []);
    expect(conventions).not.toContain('Conversation so far');
  });

  it('mentions the content editor as an image-replacement option only for static projects', () => {
    expect(buildConventions([], 'static', [])).toContain('content editor');
    expect(buildConventions([], 'dynamic', [])).not.toContain('content editor');
  });

  it('includes the responsive-design rule for both site types', () => {
    expect(buildConventions([], 'static', [])).toContain('Responsive:');
    expect(buildConventions([], 'dynamic', [])).toContain('Responsive:');
  });

  it('documents the markdown field type and its CDN rendering rule for static projects', () => {
    const conventions = buildConventions([], 'static', []);
    expect(conventions).toContain('markdown');
    expect(conventions).toContain('marked.parse');
  });
});

describe('buildClaudePrompt', () => {
  it('threads history through into the final prompt sent to the CLI', () => {
    const prompt = buildClaudePrompt('add dark mode', [], 'static', [
      { prompt: 'build a landing page', summary: 'Built a landing page with a hero and footer.' },
    ]);
    expect(prompt).toContain('Conversation so far');
    expect(prompt).toContain('Built a landing page with a hero and footer.');
    expect(prompt).toContain("User's request:\nadd dark mode");
  });

  it('says so plainly when no design file is resolved, rather than silently omitting design guidance', () => {
    const prompt = buildClaudePrompt('add dark mode', [], 'static', [], null);
    expect(prompt).toContain('no specific reference is available');
  });
});
