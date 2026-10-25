const OpenAI = require('openai');
const env = require('../config/environment');

let client = null;
let activeProvider = null;

const getClient = () => {
  if (client) return client;

  // Priority 1: Google Gemini (via Google's official OpenAI-compatible endpoint)
  if (env.gemini && env.gemini.apiKey && env.gemini.apiKey !== 'your_gemini_api_key_here') {
    client = new OpenAI({
      apiKey: env.gemini.apiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      timeout: 15000,
    });
    activeProvider = 'gemini';
    return client;
  }

  // Priority 2: OpenAI
  if (env.openai && env.openai.apiKey && env.openai.apiKey !== 'sk-your-openai-api-key-here') {
    const opts = { apiKey: env.openai.apiKey, timeout: 15000 };
    if (env.openai.baseURL) opts.baseURL = env.openai.baseURL;
    client = new OpenAI(opts);
    activeProvider = 'openai';
    return client;
  }

  return null;
};

const getModel = () => {
  if (activeProvider === 'gemini') {
    return env.gemini.model || 'gemini-1.5-flash';
  }
  return env.openai.model || 'gpt-4o-mini';
};

const TICKET_SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Concise issue title, max 100 chars' },
    category: { type: 'string', description: 'One of the valid categories' },
    suggestedDepartment: { type: 'string', description: 'Suggested responsible department name' },
    description: { type: 'string', description: 'Clear, brief description of the issue' },
    missingInformation: { type: 'array', items: { type: 'string' }, description: 'Any missing details needed' },
    requiresHumanReview: { type: 'boolean' },
  },
  required: ['title', 'category', 'description', 'missingInformation', 'requiresHumanReview'],
  additionalProperties: false,
};

exports.suggestTicket = async (description, { validCategories, validDepartments }) => {
  const ai = getClient();
  if (!ai) throw new Error('AI service not configured (set GEMINI_API_KEY or OPENAI_API_KEY)');

  const systemPrompt = `You are an AI assistant for a hospital operations management system called WardFlow.
Your job is to analyze a reported issue description and extract structured ticket information.

Valid categories: ${validCategories.join(', ')}
Known departments: ${validDepartments.join(', ')}

Always respond with valid JSON matching the schema. Pick the most appropriate category from the valid list.
Suggest the most likely responsible department from the known departments list.
Keep the title concise (under 100 characters).
List any missing information that would help resolve the issue faster.`;

  const response = await ai.chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Issue description: ${description}` },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ticket_suggestion',
        strict: true,
        schema: TICKET_SUGGESTION_SCHEMA,
      },
    },
    temperature: 0.3,
    max_tokens: 500,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from AI');

  return JSON.parse(content);
};

exports.summarizeTickets = async (tickets, overdueTickets) => {
  const ai = getClient();
  if (!ai) throw new Error('AI service not configured (set GEMINI_API_KEY or OPENAI_API_KEY)');

  const ticketSummaryData = tickets.map(t => ({
    number: t.ticketNumber,
    title: t.title,
    category: t.category,
    priority: t.priority,
    status: t.status,
    isOverdue: overdueTickets.some(o => o._id?.toString() === t._id?.toString()),
  }));

  const systemPrompt = `You are a hospital operations analyst. Summarize the current state of open tickets for management.
Highlight: critical issues, overdue tickets, patterns by category, and recommended actions.
Be concise and actionable. Use bullet points. Keep the summary under 300 words.`;

  const response = await ai.chat.completions.create({
    model: getModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Current open tickets (${tickets.length} total, ${overdueTickets.length} overdue):\n${JSON.stringify(ticketSummaryData, null, 2)}`,
      },
    ],
    temperature: 0.5,
    max_tokens: 600,
  });

  return response.choices[0]?.message?.content || 'Summary unavailable.';
};

const geminiIncidentSummaryService = require('./geminiIncidentSummaryService');

exports.generateIncidentSummary = (opts) => geminiIncidentSummaryService.generateIncidentSummary(opts);
exports.sanitizeHospitalText = (text) => geminiIncidentSummaryService.sanitizeHospitalText(text);
