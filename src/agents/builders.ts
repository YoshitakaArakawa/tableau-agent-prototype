import { Agent } from '@openai/agents';
import { resolveModel } from '../config/modelResolver';
import { loadPrompt } from '../prompts/loadPrompt';

export function buildTriageAgent() {
  const model = resolveModel('triage');
  const instructions = loadPrompt('triage');
  return new Agent({ name: 'triage', model, instructions });
}

export function buildFieldSelectorAgent() {
  const model = resolveModel('field-selector');
  const instructions = loadPrompt('field-selector');
  return new Agent({ name: 'field-selector', model, instructions });
}

export function buildVizqlAdapterAgent() {
  const model = resolveModel('vizql-adapter');
  const instructions = loadPrompt('vizql-adapter');
  return new Agent({ name: 'vizql-adapter', model, instructions });
}

export function buildResultAgent() {
  const model = resolveModel('result');
  const instructions = loadPrompt('result');
  return new Agent({ name: 'result', model, instructions });
}

export default { buildTriageAgent, buildFieldSelectorAgent, buildVizqlAdapterAgent, buildResultAgent };
