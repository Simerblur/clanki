import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as http from "http";

// Constants
const ANKI_CONNECT_URL = "http://localhost:8765";

// Type definitions for Anki responses
interface AnkiCard {
  noteId: number;
  fields: {
    Front: { value: string };
    Back: { value: string };
  };
  tags: string[];
}

interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

interface MediaItem {
  url: string;
  filename: string;
  skipHash?: string;
  fields: string[];
}

// Validation schemas
const ListDecksArgumentsSchema = z.object({});

const CreateDeckArgumentsSchema = z.object({
  name: z.string().min(1),
});

const CreateCardArgumentsSchema = z.object({
  deckName: z.string(),
  front: z.string().optional(),
  back: z.string().optional(),
  tags: z.array(z.string()).optional(),
  frontImages: z.array(z.string()).optional(),
  backImages: z.array(z.string()).optional(),
  frontAudio: z.array(z.string()).optional(),
  backAudio: z.array(z.string()).optional(),
  modelName: z.string().optional(),
  fields: z.record(z.string()).optional(),
});

const CreateClozeCardArgumentsSchema = z.object({
  deckName: z.string(),
  text: z.string(),
  backExtra: z.string().optional(),
  tags: z.array(z.string()).optional(),
  textImages: z.array(z.string()).optional(),
  backImages: z.array(z.string()).optional(),
  textAudio: z.array(z.string()).optional(),
  backAudio: z.array(z.string()).optional(),
});

const UpdateCardArgumentsSchema = z.object({
  noteId: z.number(),
  front: z.string().optional(),
  back: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateClozeCardArgumentsSchema = z.object({
  noteId: z.number(),
  text: z.string().optional(),
  backExtra: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const CreateNoteTypeArgumentsSchema = z.object({
  name: z.string().min(1),
  fields: z.array(z.string()).min(1),
  templates: z.array(
    z.object({
      name: z.string(),
      qfmt: z.string(),
      afmt: z.string(),
    })
  ).min(1),
  css: z.string().optional(),
});

const UpsertNoteArgumentsSchema = z.object({
  deckName: z.string(),
  modelName: z.string(),
  fields: z.record(z.string()),
  primaryField: z.string(),
  tags: z.array(z.string()).optional(),
});

const SearchNotesArgumentsSchema = z.object({
  query: z.string(),
});

const GetNoteInfoArgumentsSchema = z.object({
  noteIds: z.array(z.number()),
});

const FindDuplicatesArgumentsSchema = z.object({
  deckName: z.string(),
  text: z.string(),
  searchIn: z.enum(["front", "back", "any"]).optional(),
});

// Helper function for making AnkiConnect requests with retries
async function ankiRequest<T>(
  action: string,
  params: Record<string, any> = {},
  retries = 3,
  delay = 1000
): Promise<T> {
  console.error(
    `Attempting AnkiConnect request: ${action} with params:`,
    params
  );

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await new Promise<T>((resolve, reject) => {
        const data = JSON.stringify({
          action,
          version: 6,
          params,
        });

        console.error("Request payload:", data);

        const options = {
          hostname: "127.0.0.1",
          port: 8765,
          path: "/",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
          },
        };

        const req = http.request(options, (res) => {
          let responseData = "";

          res.on("data", (chunk: Buffer) => {
            responseData += chunk.toString();
          });

          res.on("end", () => {
            console.error(`AnkiConnect response status: ${res.statusCode}`);
            console.error(`AnkiConnect response body: ${responseData}`);

            if (res.statusCode !== 200) {
              reject(
                new Error(
                  `AnkiConnect request failed with status ${res.statusCode}: ${responseData}`
                )
              );
              return;
            }

            try {
              const parsedData = JSON.parse(responseData) as AnkiResponse<T>;
              console.error("Parsed response:", parsedData);

              if (parsedData.error) {
                reject(new Error(`AnkiConnect error: ${parsedData.error}`));
                return;
              }

              // Some actions like updateNoteFields return null on success
              if (
                parsedData.result === null ||
                parsedData.result === undefined
              ) {
                // For actions that are expected to return null/undefined, return an empty success response
                if (action === "updateNoteFields" || action === "replaceTags") {
                  resolve({} as T);
                  return;
                }
                // For other actions, treat null/undefined as an error
                reject(new Error("AnkiConnect returned null/undefined result"));
                return;
              }

              resolve(parsedData.result);
            } catch (parseError) {
              console.error("Parse error:", parseError);
              reject(
                new Error(
                  `Failed to parse AnkiConnect response: ${responseData}`
                )
              );
            }
          });
        });

        req.on("error", (error: Error) => {
          console.error(
            `Error in ankiRequest (attempt ${attempt}/${retries}):`,
            error
          );
          reject(error);
        });

        // Write data to request body
        req.write(data);
        req.end();
      });

      return result;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.error(
        `Attempt ${attempt}/${retries} failed, retrying after ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      // Increase delay for next attempt
      delay *= 2;
    }
  }

  throw new Error(`Failed after ${retries} attempts`);
}

// Helper function to build media objects for AnkiConnect
function buildMediaArray(
  urls: string[] | undefined,
  fieldName: string,
  mediaType: "image" | "audio"
): MediaItem[] {
  if (!urls || urls.length === 0) return [];

  return urls.map((url, index) => {
    try {
      // Extract file extension from URL or use default
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const urlFilename = pathParts[pathParts.length - 1];

      // Generate unique filename
      const timestamp = Date.now();
      const extension = urlFilename.includes('.')
        ? urlFilename.split('.').pop()
        : (mediaType === "image" ? "jpg" : "mp3");
      const filename = `${mediaType}_${fieldName}_${timestamp}_${index}.${extension}`;

      return {
        url,
        filename,
        fields: [fieldName],
      };
    } catch (error) {
      console.error(`Invalid URL skipped: ${url}`, error);
      return null;
    }
  }).filter((item): item is MediaItem => item !== null);
}

// Helper function to ensure note type exists (create if missing)
async function ensureNoteType(
  modelName: string,
  fields: string[],
  templates: any[],
  css?: string
): Promise<{ exists: boolean; created: boolean }> {
  try {
    // Get all existing model names
    const existingModels = await ankiRequest<string[]>("modelNames", {});

    if (existingModels.includes(modelName)) {
      console.error(`Note type "${modelName}" already exists, skipping creation`);
      return { exists: true, created: false };
    }

    // Create the model
    await ankiRequest("createModel", {
      modelName,
      inOrderFields: fields,
      cardTemplates: templates,
      css: css || ".card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }",
    });

    console.error(`Created note type "${modelName}"`);
    return { exists: true, created: true };
  } catch (error) {
    console.error(`Failed to ensure note type "${modelName}":`, error);
    throw error;
  }
}

// Helper function to ensure deck exists (create if missing)
async function ensureDeck(deckName: string): Promise<{ exists: boolean; created: boolean }> {
  try {
    // Get all deck names
    const existingDecks = await ankiRequest<string[]>("deckNames", {});

    if (existingDecks.includes(deckName)) {
      console.error(`Deck "${deckName}" already exists`);
      return { exists: true, created: false };
    }

    // Create the deck
    await ankiRequest("createDeck", { deck: deckName });
    console.error(`Created deck "${deckName}"`);
    return { exists: true, created: true };
  } catch (error) {
    console.error(`Failed to ensure deck "${deckName}":`, error);
    throw error;
  }
}

// Helper function to check AnkiConnect health
async function checkAnkiConnectHealth(): Promise<{ healthy: boolean; message?: string }> {
  try {
    // Try to ping AnkiConnect
    await ankiRequest("version", {});
    return { healthy: true };
  } catch (error) {
    return {
      healthy: false,
      message: `Cannot connect to AnkiConnect. Please ensure:
1. Anki is running
2. AnkiConnect plugin is installed
3. You can access http://localhost:8765

Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// Helper interface and function for structured error responses
interface StructuredError {
  type: 'validation' | 'connection' | 'anki' | 'duplicate' | 'not_found' | 'unknown';
  message: string;
  suggestion?: string;
  details?: any;
}

function formatErrorResponse(error: unknown): { content: { type: string; text: string }[] } {
  let structuredError: StructuredError;

  if (error instanceof z.ZodError) {
    structuredError = {
      type: 'validation',
      message: `Invalid input: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
      suggestion: 'Please check your input parameters and try again.',
    };
  } else if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('cannot connect') || message.includes('ankiconnect')) {
      structuredError = {
        type: 'connection',
        message: error.message,
        suggestion: `Please verify:
1. Anki is running
2. AnkiConnect plugin is active
3. Visit http://localhost:8765 to test the connection`,
      };
    } else if (message.includes('already exists') || message.includes('duplicate')) {
      structuredError = {
        type: 'duplicate',
        message: error.message,
        suggestion: 'The item already exists. This is usually fine - continuing to use the existing one.',
      };
    } else if (message.includes('not found') || message.includes('does not exist')) {
      structuredError = {
        type: 'not_found',
        message: error.message,
        suggestion: 'The requested item was not found. It may have been deleted or the name may be incorrect.',
      };
    } else {
      structuredError = {
        type: 'anki',
        message: error.message,
        suggestion: 'An error occurred in Anki. Check the Anki application for more details.',
      };
    }
  } else {
    structuredError = {
      type: 'unknown',
      message: String(error),
      suggestion: 'An unexpected error occurred. Please try again.',
    };
  }

  let responseText = `❌ Error: ${structuredError.message}`;
  if (structuredError.suggestion) {
    responseText += `\n\n💡 Suggestion: ${structuredError.suggestion}`;
  }

  return {
    content: [
      {
        type: "text",
        text: responseText,
      },
    ],
  };
}

async function main() {
  // Create server instance
  const server = new Server(
    {
      name: "anki-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "create-deck",
          description: "Create a new Anki deck",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Name for the new deck",
              },
            },
            required: ["name"],
          },
        },

        {
          name: "create-card",
          description: "Create a new flashcard in a specified deck. Supports both Basic cards (front/back) and custom note types with arbitrary fields. Supports HTML formatting in text fields. You can attach multiple images and audio files from URLs - they will be automatically downloaded and embedded in the card.",
          inputSchema: {
            type: "object",
            properties: {
              deckName: {
                type: "string",
                description: "Name of the deck to add the card to",
              },
              front: {
                type: "string",
                description: "Front side content of the card (supports HTML formatting). Use this with 'back' for Basic note type. Cannot be used with 'fields'.",
              },
              back: {
                type: "string",
                description: "Back side content of the card (supports HTML formatting). Use this with 'front' for Basic note type. Cannot be used with 'fields'.",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Optional tags for the card",
              },
              frontImages: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of image URLs to embed on the front of the card. Images will be downloaded and attached automatically.",
              },
              backImages: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of image URLs to embed on the back of the card. Images will be downloaded and attached automatically.",
              },
              frontAudio: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of audio file URLs to attach to the front of the card. Audio will be downloaded and can be played in Anki.",
              },
              backAudio: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of audio file URLs to attach to the back of the card. Audio will be downloaded and can be played in Anki.",
              },
              modelName: {
                type: "string",
                description: "Optional name of the note type/model to use (defaults to 'Basic'). Required when using 'fields' parameter. Use this to create cards with custom note types.",
              },
              fields: {
                type: "object",
                description: "Custom fields as key-value pairs for custom note types (e.g., {\"Hanzi\": \"马上\", \"Pinyin\": \"mǎshàng\", \"English\": \"immediately\"}). Use this instead of 'front' and 'back' when using custom note types. Requires 'modelName' to be specified.",
              },
            },
            required: ["deckName"],
          },
        },
        {
          name: "update-card",
          description: "Update an existing flashcard",
          inputSchema: {
            type: "object",
            properties: {
              noteId: {
                type: "number",
                description: "ID of the note to update",
              },
              front: {
                type: "string",
                description: "New front side content",
              },
              back: {
                type: "string",
                description: "New back side content",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "New tags for the card",
              },
            },
            required: ["noteId"],
          },
        },
        {
          name: "create-cloze-card",
          description:
            "Create a new cloze deletion card in a specified deck. Use {{c1::text}} syntax for cloze deletions (e.g., {{c1::Paris}} is the capital of France). Supports HTML formatting and can attach multiple images and audio files from URLs - they will be automatically downloaded and embedded.",
          inputSchema: {
            type: "object",
            properties: {
              deckName: {
                type: "string",
                description: "Name of the deck to add the card to",
              },
              text: {
                type: "string",
                description:
                  "Text containing cloze deletions using {{c1::text}} syntax. Supports HTML formatting. Use {{c1::word}}, {{c2::word}}, etc. for multiple deletions.",
              },
              backExtra: {
                type: "string",
                description:
                  "Optional extra information to show on the back of the card (supports HTML formatting)",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Optional tags for the card",
              },
              textImages: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of image URLs to embed in the main text field. Images will be downloaded and attached automatically.",
              },
              backImages: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of image URLs to embed in the back extra field. Images will be downloaded and attached automatically.",
              },
              textAudio: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of audio file URLs to attach to the main text field. Audio will be downloaded and can be played in Anki.",
              },
              backAudio: {
                type: "array",
                items: { type: "string" },
                description: "Optional array of audio file URLs to attach to the back extra field. Audio will be downloaded and can be played in Anki.",
              },
            },
            required: ["deckName", "text"],
          },
        },
        {
          name: "update-cloze-card",
          description: "Update an existing cloze deletion card",
          inputSchema: {
            type: "object",
            properties: {
              noteId: {
                type: "number",
                description: "ID of the note to update",
              },
              text: {
                type: "string",
                description:
                  "New text with cloze deletions using {{c1::text}} syntax",
              },
              backExtra: {
                type: "string",
                description:
                  "New extra information to show on the back of the card",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "New tags for the card",
              },
            },
            required: ["noteId"],
          },
        },
        {
          name: "create-note-type",
          description: "Create a custom Anki note type (model) with custom fields, card templates, and styling. This allows you to create specialized card types beyond the default Basic and Cloze types.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Name for the new note type (must be unique)",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description: "Array of field names for the note type (e.g., ['Front', 'Back', 'Example'])",
              },
              templates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    qfmt: { type: "string" },
                    afmt: { type: "string" },
                  },
                  required: ["name", "qfmt", "afmt"],
                },
                description: "Array of card templates. Each template has: name (template name), qfmt (question/front format using {{FieldName}} syntax), afmt (answer/back format using {{FieldName}} and {{FrontSide}} syntax)",
              },
              css: {
                type: "string",
                description: "Optional CSS styling for the cards (default: '.card { text-align: center; }')",
              },
            },
            required: ["name", "fields", "templates"],
          },
        },
        {
          name: "search-notes",
          description: "Search for notes using Anki's query syntax. Useful for finding existing cards before creating new ones, searching by tags, content, or other criteria. Returns note IDs and basic information.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Anki search query. Examples: 'deck:Spanish tag:verb', 'front:hola', 'tag:HSK3', '\"马上\"' (exact phrase), 'deck:\"Chinese HSK\" Hanzi:马上'. See Anki documentation for full query syntax.",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "get-note-info",
          description: "Get detailed information about specific notes by their IDs. Returns all fields, tags, model name, and other metadata. Use this after search-notes to get full details about found notes.",
          inputSchema: {
            type: "object",
            properties: {
              noteIds: {
                type: "array",
                items: { type: "number" },
                description: "Array of note IDs to retrieve information for",
              },
            },
            required: ["noteIds"],
          },
        },
        {
          name: "find-duplicates",
          description: "Find existing notes in a deck that contain similar text. Useful for checking if a card already exists before creating a new one to avoid duplicates.",
          inputSchema: {
            type: "object",
            properties: {
              deckName: {
                type: "string",
                description: "Name of the deck to search in",
              },
              text: {
                type: "string",
                description: "Text to search for in existing notes",
              },
              searchIn: {
                type: "string",
                enum: ["front", "back", "any"],
                description: "Where to search for the text: 'front' (Front field only), 'back' (Back field only), or 'any' (any field). Defaults to 'any'.",
              },
            },
            required: ["deckName", "text"],
          },
        },
        {
          name: "upsert-note",
          description: "Atomically finds a note by a primary field value; updates it if found, or creates it if missing. This is the recommended way to create cards as it prevents duplicates and is faster than separate search + create operations.",
          inputSchema: {
            type: "object",
            properties: {
              deckName: {
                type: "string",
                description: "Name of the deck to add/update the note in",
              },
              modelName: {
                type: "string",
                description: "Name of the note type/model to use (e.g., 'Basic', 'Cloze', or custom note type name)",
              },
              fields: {
                type: "object",
                description: "Key-value pairs of field data (e.g., {'Hanzi': '马上', 'Pinyin': 'mǎshàng', 'English': 'immediately'})",
              },
              primaryField: {
                type: "string",
                description: "The specific field name to check for duplicates (e.g., 'Hanzi', 'Front'). Must be a key in the fields object.",
              },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Optional tags for the note",
              },
            },
            required: ["deckName", "modelName", "fields", "primaryField"],
          },
        },
      ],
    };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "create-deck") {
        const { name: deckName } = CreateDeckArgumentsSchema.parse(args);
        await ankiRequest("createDeck", {
          deck: deckName,
        });
        return {
          content: [
            {
              type: "text",
              text: `Successfully created new deck "${deckName}"`,
            },
          ],
        };
      }

      if (name === "create-card") {
        const {
          deckName,
          front,
          back,
          tags = [],
          frontImages = [],
          backImages = [],
          frontAudio = [],
          backAudio = [],
          modelName,
          fields,
        } = CreateCardArgumentsSchema.parse(args);

        // Validate input: either use front/back OR fields, not both
        if (fields && (front || back)) {
          throw new Error("Cannot use both 'fields' and 'front'/'back' parameters. Use 'fields' for custom note types or 'front'/'back' for Basic cards.");
        }

        if (fields && !modelName) {
          throw new Error("'modelName' is required when using 'fields' parameter.");
        }

        if (!fields && (!front || !back)) {
          throw new Error("Either provide 'front' and 'back' for Basic cards, or 'fields' and 'modelName' for custom note types.");
        }

        // Determine the model and fields to use
        const actualModelName = modelName || "Basic";
        const actualFields = fields || { Front: front, Back: back };

        // Ensure deck exists
        await ensureDeck(deckName);

        // Build picture and audio arrays for AnkiConnect
        // For custom models, we need to use the field names from the fields object
        let picture: any[] = [];
        let audio: any[] = [];

        if (fields) {
          // For custom models, we don't support field-specific media yet
          // All media goes to the first field
          const firstField = Object.keys(fields)[0];
          picture = [
            ...buildMediaArray(frontImages, firstField, "image"),
            ...buildMediaArray(backImages, firstField, "image"),
          ];
          audio = [
            ...buildMediaArray(frontAudio, firstField, "audio"),
            ...buildMediaArray(backAudio, firstField, "audio"),
          ];
        } else {
          // For Basic cards, use Front/Back
          picture = [
            ...buildMediaArray(frontImages, "Front", "image"),
            ...buildMediaArray(backImages, "Back", "image"),
          ];
          audio = [
            ...buildMediaArray(frontAudio, "Front", "audio"),
            ...buildMediaArray(backAudio, "Back", "audio"),
          ];
        }

        const noteParams: any = {
          note: {
            deckName,
            modelName: actualModelName,
            fields: actualFields,
            tags,
          },
        };

        // Only add picture/audio arrays if they have items
        if (picture.length > 0) {
          noteParams.note.picture = picture;
        }
        if (audio.length > 0) {
          noteParams.note.audio = audio;
        }

        await ankiRequest("addNote", noteParams);

        const mediaInfo = [];
        if (picture.length > 0) mediaInfo.push(`${picture.length} image(s)`);
        if (audio.length > 0) mediaInfo.push(`${audio.length} audio file(s)`);
        const mediaText = mediaInfo.length > 0 ? ` with ${mediaInfo.join(" and ")}` : "";

        return {
          content: [
            {
              type: "text",
              text: `Successfully created new card in deck "${deckName}" using model "${actualModelName}"${mediaText}`,
            },
          ],
        };
      }

      if (name === "update-card") {
        const { noteId, front, back, tags } =
          UpdateCardArgumentsSchema.parse(args);

        if (front || back) {
          const fields: Record<string, string> = {};
          if (front) fields.Front = front;
          if (back) fields.Back = back;

          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });
        }

        if (tags) {
          await ankiRequest("replaceTags", {
            notes: [noteId],
            tags: tags.join(" "),
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated note ${noteId}`,
            },
          ],
        };
      }

      if (name === "create-cloze-card") {
        const {
          deckName,
          text,
          backExtra = "",
          tags = [],
          textImages = [],
          backImages = [],
          textAudio = [],
          backAudio = [],
        } = CreateClozeCardArgumentsSchema.parse(args);

        // Validate that the text contains at least one cloze deletion
        if (!text.includes("{{c") || !text.includes("}}")) {
          throw new Error(
            "Text must contain at least one cloze deletion using {{c1::text}} syntax"
          );
        }

        // Ensure deck exists
        await ensureDeck(deckName);

        // Build picture and audio arrays for AnkiConnect
        const picture = [
          ...buildMediaArray(textImages, "Text", "image"),
          ...buildMediaArray(backImages, "Back Extra", "image"),
        ];

        const audio = [
          ...buildMediaArray(textAudio, "Text", "audio"),
          ...buildMediaArray(backAudio, "Back Extra", "audio"),
        ];

        const noteParams: any = {
          note: {
            deckName,
            modelName: "Cloze",
            fields: {
              Text: text,
              "Back Extra": backExtra,
            },
            tags,
          },
        };

        // Only add picture/audio arrays if they have items
        if (picture.length > 0) {
          noteParams.note.picture = picture;
        }
        if (audio.length > 0) {
          noteParams.note.audio = audio;
        }

        await ankiRequest("addNote", noteParams);

        const mediaInfo = [];
        if (picture.length > 0) mediaInfo.push(`${picture.length} image(s)`);
        if (audio.length > 0) mediaInfo.push(`${audio.length} audio file(s)`);
        const mediaText = mediaInfo.length > 0 ? ` with ${mediaInfo.join(" and ")}` : "";

        return {
          content: [
            {
              type: "text",
              text: `Successfully created new cloze card in deck "${deckName}"${mediaText}`,
            },
          ],
        };
      }

      if (name === "update-cloze-card") {
        const { noteId, text, backExtra, tags } =
          UpdateClozeCardArgumentsSchema.parse(args);

        // Get the current note info to verify it's a cloze note
        const noteInfo = await ankiRequest<any[]>("notesInfo", {
          notes: [noteId],
        });

        if (noteInfo.length === 0) {
          throw new Error(`No note found with ID ${noteId}`);
        }

        if (noteInfo[0].modelName !== "Cloze") {
          throw new Error("This note is not a cloze deletion note");
        }

        // Update fields if provided
        if (text || backExtra !== undefined) {
          const fields: Record<string, string> = {};
          if (text) {
            // Validate that the text contains at least one cloze deletion
            if (!text.includes("{{c") || !text.includes("}}")) {
              throw new Error(
                "Text must contain at least one cloze deletion using {{c1::text}} syntax"
              );
            }
            fields.Text = text;
          }
          if (backExtra !== undefined) {
            fields["Back Extra"] = backExtra;
          }

          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });
        }

        // Update tags if provided
        if (tags) {
          await ankiRequest("replaceTags", {
            notes: [noteId],
            tags: tags.join(" "),
          });
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully updated cloze note ${noteId}`,
            },
          ],
        };
      }

      if (name === "create-note-type") {
        const { name: modelName, fields, templates, css } =
          CreateNoteTypeArgumentsSchema.parse(args);

        const result = await ensureNoteType(modelName, fields, templates, css);

        if (result.created) {
          return {
            content: [
              {
                type: "text",
                text: `Successfully created note type "${modelName}" with fields: ${fields.join(", ")}`,
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Note type "${modelName}" already exists. Using existing note type.`,
              },
            ],
          };
        }
      }

      if (name === "search-notes") {
        const { query } = SearchNotesArgumentsSchema.parse(args);

        const noteIds = await ankiRequest<number[]>("findNotes", { query });

        return {
          content: [
            {
              type: "text",
              text: `Found ${noteIds.length} notes matching query "${query}".\n\nNote IDs: ${noteIds.join(", ")}`,
            },
          ],
        };
      }

      if (name === "get-note-info") {
        const { noteIds } = GetNoteInfoArgumentsSchema.parse(args);

        const notesInfo = await ankiRequest<any[]>("notesInfo", {
          notes: noteIds,
        });

        const formattedNotes = notesInfo
          .map((note) => {
            const fieldEntries = Object.entries(note.fields)
              .map(([key, value]: [string, any]) => `  ${key}: ${value.value}`)
              .join("\n");
            return `Note ID: ${note.noteId}\nModel: ${note.modelName}\nFields:\n${fieldEntries}\nTags: ${note.tags.join(", ")}\n---`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `Retrieved information for ${notesInfo.length} note(s):\n\n${formattedNotes}`,
            },
          ],
        };
      }

      if (name === "find-duplicates") {
        const { deckName, text, searchIn = "any" } = FindDuplicatesArgumentsSchema.parse(args);

        let query = `deck:"${deckName}"`;

        if (searchIn === "front") {
          query += ` Front:*${text}*`;
        } else if (searchIn === "back") {
          query += ` Back:*${text}*`;
        } else {
          query += ` *${text}*`;
        }

        const noteIds = await ankiRequest<number[]>("findNotes", { query });

        if (noteIds.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No duplicate notes found for "${text}" in deck "${deckName}".`,
              },
            ],
          };
        }

        const notesInfo = await ankiRequest<any[]>("notesInfo", {
          notes: noteIds,
        });

        const formattedNotes = notesInfo
          .map((note) => {
            const fieldEntries = Object.entries(note.fields)
              .map(([key, value]: [string, any]) => `  ${key}: ${value.value}`)
              .join("\n");
            return `Note ID: ${note.noteId}\nModel: ${note.modelName}\nFields:\n${fieldEntries}\nTags: ${note.tags.join(", ")}\n---`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `Found ${noteIds.length} potential duplicate(s) for "${text}" in deck "${deckName}":\n\n${formattedNotes}`,
            },
          ],
        };
      }

      if (name === "upsert-note") {
        const { deckName, modelName, fields, primaryField, tags = [] } =
          UpsertNoteArgumentsSchema.parse(args);

        // Validate that primaryField exists in fields
        if (!(primaryField in fields)) {
          throw new Error(
            `Primary field "${primaryField}" not found in fields object. Available fields: ${Object.keys(fields).join(", ")}`
          );
        }

        const primaryValue = fields[primaryField];

        // Ensure deck exists
        await ensureDeck(deckName);

        // Search for existing note by primary field value
        const query = `deck:"${deckName}" ${primaryField}:"${primaryValue}"`;
        const existingNoteIds = await ankiRequest<number[]>("findNotes", { query });

        if (existingNoteIds.length > 0) {
          // Update existing note
          const noteId = existingNoteIds[0];

          // Update fields
          await ankiRequest("updateNoteFields", {
            note: {
              id: noteId,
              fields,
            },
          });

          // Update tags
          await ankiRequest("replaceTags", {
            notes: [noteId],
            tags: tags.join(" "),
          });

          return {
            content: [
              {
                type: "text",
                text: `Updated existing note ${noteId} in deck "${deckName}" (matched by ${primaryField}: "${primaryValue}")`,
              },
            ],
          };
        } else {
          // Create new note
          const noteParams: any = {
            note: {
              deckName,
              modelName,
              fields,
              tags,
            },
          };

          const noteId = await ankiRequest<number>("addNote", noteParams);

          return {
            content: [
              {
                type: "text",
                text: `Created new note ${noteId} in deck "${deckName}" using model "${modelName}"`,
              },
            ],
          };
        }
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      console.error(`Error executing tool "${name}":`, error);
      return formatErrorResponse(error);
    }
  });

  // Add resource handlers for listing decks
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const decks = await ankiRequest<string[]>("deckNames");
      return {
        resources: decks.map((deck) => ({
          uri: `anki://deck/${encodeURIComponent(deck)}`,
          name: deck,
          description: `Anki deck: ${deck}`,
        })),
      };
    } catch (error) {
      console.error("Error listing resources:", error);
      throw error;
    }
  });

  // Add handler for reading deck contents
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
      const uri = request.params.uri;
      const match = uri.match(/^anki:\/\/deck\/(.+)$/);

      if (!match) {
        throw new Error(`Invalid resource URI: ${uri}`);
      }

      const deckName = decodeURIComponent(match[1]);
      console.error(`Attempting to fetch cards for deck: ${deckName}`);

      // Find all notes in the deck
      const noteIds = await ankiRequest<number[]>("findNotes", {
        query: `deck:${deckName}`,
      });

      console.error(`Found ${noteIds.length} notes in deck ${deckName}`);

      if (noteIds.length === 0) {
        return {
          contents: [
            {
              uri,
              mimeType: "text/plain",
              text: `Deck: ${deckName}\n\nNo notes found in this deck.`,
            },
          ],
        };
      }

      // Process notes in chunks of 5
      const chunkSize = 5;
      let allNotes: any[] = [];

      for (let i = 0; i < noteIds.length; i += chunkSize) {
        const chunk = noteIds.slice(i, i + chunkSize);
        console.error(
          `Processing notes ${i + 1} to ${Math.min(
            i + chunkSize,
            noteIds.length
          )}`
        );

        const chunkNotes = await ankiRequest<any[]>("notesInfo", {
          notes: chunk,
        });
        allNotes = allNotes.concat(chunkNotes);
      }

      console.error(`Retrieved ${allNotes.length} notes total`);

      // Debug log to see note structure
      console.error(
        "First note structure:",
        JSON.stringify(allNotes[0], null, 2)
      );
      if (allNotes.length > 1) {
        console.error(
          "Second note structure:",
          JSON.stringify(allNotes[1], null, 2)
        );
      }

      // Map notes to our card format
      const cardInfo: AnkiCard[] = allNotes.map((note) => {
        if (note.modelName === "Cloze") {
          return {
            noteId: note.noteId,
            fields: {
              Front: { value: note.fields.Text.value },
              Back: {
                value: note.fields["Back Extra"].value || "[Cloze deletion]",
              },
            },
            tags: note.tags,
          };
        } else if (note.modelName === "Basic") {
          return {
            noteId: note.noteId,
            fields: {
              Front: { value: note.fields.Front.value },
              Back: { value: note.fields.Back.value },
            },
            tags: note.tags,
          };
        } else {
          // Default case for unknown note types
          console.error(`Unknown note type: ${note.modelName}`);
          return {
            noteId: note.noteId,
            fields: {
              Front: { value: "[Unknown note type]" },
              Back: { value: "[Unknown note type]" },
            },
            tags: note.tags,
          };
        }
      });

      console.error(`Successfully retrieved info for ${cardInfo.length} cards`);

      const deckContent = cardInfo
        .map((card) => {
          return `Note ID: ${card.noteId}\nFront: ${
            card.fields.Front.value
          }\nBack: ${card.fields.Back.value}\nTags: ${card.tags.join(
            ", "
          )}\n---`;
        })
        .join("\n");

      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text: `Deck: ${deckName}\n\n${deckContent}`,
          },
        ],
      };
    } catch (error) {
      console.error(`Error reading deck: ${error}`);
      throw new Error(
        `Failed to read deck: ${
          error instanceof Error ? error.message : "Unknown error"
        }. Make sure Anki is running and AnkiConnect plugin is installed.`
      );
    }
  });

  // Check AnkiConnect health on startup
  console.error("Checking AnkiConnect connection...");
  const health = await checkAnkiConnectHealth();
  if (!health.healthy) {
    console.error("WARNING: AnkiConnect is not responding:");
    console.error(health.message);
    console.error("Server will start, but operations will fail until Anki is running.");
  } else {
    console.error("AnkiConnect connection: OK");
  }

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Anki MCP Server running on stdio");
}

// Run the server
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
