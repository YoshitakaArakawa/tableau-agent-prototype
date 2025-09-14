const { Agent } = require('@openai/agents');
const { resolveModel } = require('../config/modelResolver');
const { loadPrompt } = require('../prompts/loadPrompt');

function buildTriageAgent() {
  const model = resolveModel('triage');
  const instructions = loadPrompt('triage');
  return new Agent({ name: 'triage', model, instructions });
}

function buildFieldSelectorAgent() {
  const model = resolveModel('field-selector');
  const instructions = loadPrompt('field-selector');
  return new Agent({ name: 'field-selector', model, instructions });
}

function buildVizqlAdapterAgent() {
  const model = resolveModel('vizql-adapter');
  const instructions = loadPrompt('vizql-adapter');
  return new Agent({ name: 'vizql-adapter', model, instructions });
}

function buildResultAgent() {
  const model = resolveModel('result');
  const instructions = loadPrompt('result');
  return new Agent({ name: 'result', model, instructions });
}

module.exports = {
  buildTriageAgent,
  buildFieldSelectorAgent,
  buildVizqlAdapterAgent,
  buildResultAgent,
};

