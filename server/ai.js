function compactEncounter(encounter = {}) {
  return {
    visitType: String(encounter.type || '').slice(0, 80),
    complaint: String(encounter.chiefComplaint || '').slice(0, 500),
    symptoms: Array.isArray(encounter.symptoms) ? encounter.symptoms.slice(0, 20) : [],
    treatment: String(encounter.treatment || '').slice(0, 1000),
    disposition: String(encounter.disposition || '').slice(0, 160),
    notes: String(encounter.notes || '').slice(0, 2000),
    painScore: encounter.painScore ?? null,
    temperature: encounter.temperature ?? null,
    pulse: encounter.pulse ?? null,
    risk: encounter.risk ? {
      category: encounter.risk.category,
      rationale: encounter.risk.rationale,
    } : null,
  };
}

export function templateSummary(encounter) {
  const item = compactEncounter(encounter);
  const parts = [
    `${item.visitType || 'Clinic'} consultation for ${item.complaint || 'an unspecified concern'}.`,
    item.painScore ? `Reported pain score: ${item.painScore}/10.` : '',
    item.treatment ? `Care provided: ${item.treatment}.` : '',
    item.disposition ? `Disposition: ${item.disposition}.` : '',
    item.risk?.category ? `Decision-support classification: ${item.risk.category}; nurse review required.` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

export async function summarizeEncounter(encounter) {
  const safeEncounter = compactEncounter(encounter);
  const endpoint = process.env.AI_SUMMARY_ENDPOINT?.trim();
  const apiKey = process.env.AI_SUMMARY_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    return { draft: templateSummary(safeEncounter), provider: 'template', model: null, generatedAt: new Date().toISOString() };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ task: 'summarize_encounter', encounter: safeEncounter }),
      signal: AbortSignal.timeout(Number(process.env.AI_SUMMARY_TIMEOUT_MS || 10_000)),
    });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const payload = await response.json();
    const draft = String(payload.summary || payload.draft || '').trim();
    if (!draft) throw new Error('AI provider returned an empty summary');
    return {
      draft: draft.slice(0, 5000),
      provider: payload.provider || 'configured-provider',
      model: payload.model || null,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('AI summary provider failed; using template fallback:', error.message);
    return { draft: templateSummary(safeEncounter), provider: 'template-fallback', model: null, generatedAt: new Date().toISOString() };
  }
}
