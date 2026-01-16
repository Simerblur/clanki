[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/jasperket-clanki-badge.png)](https://mseep.ai/app/jasperket-clanki)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Clanki - Claude's Anki Integration

An MCP server that enables AI assistants like Claude to interact with Anki flashcard decks through the Model Context Protocol (MCP).

## Features

- Create and manage Anki decks
- **Create custom note types** with arbitrary fields, templates, and styling
- Create basic flashcards with front/back content
- Create cloze deletion cards
- **Create cards with custom note types** - support for any field structure
- **Atomic upsert operations** - create or update notes in a single operation
- **Attach images and audio from URLs** - automatically downloaded and embedded
- HTML formatting support in card fields
- Update existing cards and cloze deletions
- **Search notes** using Anki's powerful query syntax
- **Find duplicates** to avoid creating redundant cards
- Add and manage tags
- View deck contents and card information
- Full integration with AnkiConnect
- **Robust error handling** with helpful suggestions and auto-recovery
- **Auto-create missing decks** - no need to create decks manually
- **Duplicate-safe operations** - creating existing note types won't crash

## Prerequisites

- [Anki](https://apps.ankiweb.net/) installed and running
- [AnkiConnect](https://ankiweb.net/shared/info/2055492159) plugin installed in Anki
- Node.js 16 or higher

## Installation

1. Clone this repository:

```bash
git clone https://github.com/yourusername/clanki.git
cd clanki
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Setup

1. Make sure Anki is running and the AnkiConnect plugin is installed and enabled

2. Configure Claude for Desktop to use the server by editing `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clanki": {
      "command": "node",
      "args": ["/absolute/path/to/clanki/build/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/clanki` with the actual path to your clanki installation.

## Available Tools

### create-deck

Creates a new Anki deck

- Parameters:
  - `name`: Name for the new deck

### create-note-type

Creates a custom Anki note type (model) with custom fields, card templates, and styling.

- Parameters:
  - `name`: Name for the new note type (must be unique)
  - `fields`: Array of field names (e.g., `["Hanzi", "Pinyin", "English", "Sentence", "Notes"]`)
  - `templates`: Array of card templates with `name`, `qfmt` (question format), and `afmt` (answer format)
  - `css`: (Optional) CSS styling for the cards

### upsert-note

**Recommended for creating cards.** Atomically finds a note by a primary field value; updates it if found, or creates it if missing. This prevents duplicates and is faster than separate search + create operations.

- Parameters:
  - `deckName`: Name of the deck to add/update the note in
  - `modelName`: Name of the note type/model to use (e.g., `"Basic"`, `"Cloze"`, or custom note type)
  - `fields`: Key-value pairs of field data (e.g., `{"Hanzi": "马上", "Pinyin": "mǎshàng", "English": "immediately"}`)
  - `primaryField`: The field name to check for duplicates (e.g., `"Hanzi"`, `"Front"`)
  - `tags`: (Optional) Array of tags for the note

### create-card

Creates a new basic flashcard in a specified deck. Supports both Basic cards (front/back) and custom note types with arbitrary fields. Supports HTML formatting and media attachments.

- Parameters:
  - `deckName`: Name of the deck to add the card to
  - **For Basic cards:**
    - `front`: Front side content of the card (supports HTML)
    - `back`: Back side content of the card (supports HTML)
  - **For custom note types:**
    - `modelName`: Name of the note type/model to use
    - `fields`: Key-value pairs of custom fields (e.g., `{"Hanzi": "马上", "Pinyin": "mǎshàng"}`)
  - `tags`: (Optional) Array of tags for the card
  - `frontImages`: (Optional) Array of image URLs for the front
  - `backImages`: (Optional) Array of image URLs for the back
  - `frontAudio`: (Optional) Array of audio URLs for the front
  - `backAudio`: (Optional) Array of audio URLs for the back

### create-cloze-card

Creates a new cloze deletion card in a specified deck. Supports HTML formatting and media attachments.

- Parameters:
  - `deckName`: Name of the deck to add the card to
  - `text`: Text containing cloze deletions using {{c1::text}} syntax (supports HTML)
  - `backExtra`: (Optional) Extra information to show on the back of the card (supports HTML)
  - `tags`: (Optional) Array of tags for the card
  - `textImages`: (Optional) Array of image URLs for the text field
  - `backImages`: (Optional) Array of image URLs for the back extra field
  - `textAudio`: (Optional) Array of audio URLs for the text field
  - `backAudio`: (Optional) Array of audio URLs for the back extra field

### update-card

Updates an existing basic flashcard

- Parameters:
  - `noteId`: ID of the note to update
  - `front`: (Optional) New front side content
  - `back`: (Optional) New back side content
  - `tags`: (Optional) New tags for the card

### update-cloze-card

Updates an existing cloze deletion card

- Parameters:
  - `noteId`: ID of the note to update
  - `text`: (Optional) New text with cloze deletions
  - `backExtra`: (Optional) New extra information for the back
  - `tags`: (Optional) New tags for the card

### search-notes

Search for notes using Anki's query syntax. Returns note IDs matching the query.

- Parameters:
  - `query`: Anki search query (e.g., `"deck:Spanish tag:verb"`, `"Hanzi:马上"`, `"tag:HSK3"`)

### get-note-info

Get detailed information about specific notes by their IDs. Returns all fields, tags, model name, and metadata.

- Parameters:
  - `noteIds`: Array of note IDs to retrieve information for

### find-duplicates

Find existing notes in a deck that contain similar text. Useful for checking if a card already exists before creating a new one.

- Parameters:
  - `deckName`: Name of the deck to search in
  - `text`: Text to search for in existing notes
  - `searchIn`: (Optional) Where to search: `"front"`, `"back"`, or `"any"` (default: `"any"`)

## Usage Examples

### Creating a custom note type for Chinese vocabulary

```
"Create a note type called 'Chinese Vocabulary' with fields: Hanzi, Pinyin, English, Sentence, and Notes"
```

### Using upsert-note (recommended for preventing duplicates)

```
"Add a Chinese flashcard for '马上' (mǎshàng) meaning 'immediately' to my HSK3 deck.
Use the Chinese Vocabulary note type and include an example sentence."
```

This will:
- Check if a card with Hanzi "马上" already exists in the deck
- If it exists: update the existing card
- If it doesn't exist: create a new card
- No duplicates are created!

### Basic card with text only
```
"Create a flashcard in my Spanish deck with 'Hola' on the front and 'Hello' on the back"
```

### Custom note type card
```
"Create a card in my Chinese deck using the Chinese Vocabulary model with:
- Hanzi: 洗手间
- Pinyin: xǐshǒujiān
- English: restroom
- Sentence: 请问，洗手间在哪里？
- Notes: Literal meaning is 'wash-hand-room'"
```

### Card with images
```
"Create a flashcard about the Eiffel Tower with an image from https://example.com/eiffel.jpg on the front"
```

### Card with audio
```
"Create a pronunciation card with audio from https://example.com/pronunciation.mp3"
```

### Card with multiple media
```
"Create a card with images on both sides and audio on the back for studying animals"
```

### Cloze card with media
```
"Create a cloze card: 'The capital of {{c1::France}} is {{c2::Paris}}' with an image of the Eiffel Tower"
```

### Searching for notes
```
"Search for all cards in my Spanish deck tagged with 'verb'"
"Find all cards with the word '马上' in my Chinese deck"
```

### Finding duplicates before creating
```
"Check if there's already a card for 'Hola' in my Spanish deck"
```

**Note:** Media files are automatically downloaded from URLs and embedded into the cards. Ensure URLs are accessible and point to valid media files.

## Development

To modify or extend the server:

1. Make changes to `src/index.ts`
2. Rebuild with `npm run build`
3. Debug with `npx @modelcontextprotocol/inspector node build/index.js`

## Troubleshooting

### Server won't start or operations fail

**Symptoms:** Error messages about AnkiConnect not responding

**Solution:**
1. Make sure Anki is running
2. Verify AnkiConnect plugin is installed: Tools → Add-ons → AnkiConnect
3. Test AnkiConnect by visiting http://localhost:8765 in your browser
4. Restart Anki if needed

### "Note type already exists" errors

**Fixed in v2.0:** The server now automatically detects existing note types and uses them instead of crashing.

### Cards not appearing in decks

**Possible causes:**
- Deck name mismatch (check spelling/capitalization)
- Anki sync conflicts
- Fields don't match note type definition

**Solution:**
- The server now auto-creates decks if they don't exist
- Check Anki to verify the deck was created
- Sync your Anki collection if using AnkiWeb

### Connection errors

The server performs health checks on startup. If you see warnings:
```
WARNING: AnkiConnect is not responding
```

This means Anki isn't running or AnkiConnect isn't active. The server will still start but operations will fail until you start Anki.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Built with the [Model Context Protocol SDK](https://github.com/modelcontextprotocol)
- Integrates with [Anki](https://apps.ankiweb.net/) via [AnkiConnect](https://foosoft.net/projects/anki-connect/)
