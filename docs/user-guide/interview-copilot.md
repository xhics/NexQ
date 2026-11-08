# How to Use NexQ as Your Interview Copilot

![NexQ Interview Copilot overlay](../../website/public/screenshots/Interview.png)

NexQ can act as your real-time interview copilot -- transcribing both sides of the conversation, surfacing AI-powered suggestions, and referencing your resume or job description on the fly.

## Prerequisites

- NexQ installed and running ([Getting Started](getting-started.md))
- An STT provider configured ([AI Providers Guide](ai-providers.md))
- An LLM provider configured ([AI Providers Guide](ai-providers.md))
- Headphones (required to prevent echo)

## Setting Up for an Interview

### 1. Choose Your STT Provider

Open Settings (`Ctrl+,`) > Speech-to-Text and configure providers for both channels:

- **Web Speech API** -- zero setup, free, good for English. Best for getting started quickly.
- **Deepgram** -- higher accuracy, real-time streaming. Requires an API key from [deepgram.com](https://deepgram.com).
- **Groq** -- very fast, free tier available. Requires an API key from [groq.com](https://groq.com).

Set the "You" channel (mic) and the "Them" channel (system audio) independently. For interviews, using the same provider for both channels works well.

### 2. Choose Your LLM Provider

Open Settings > LLM and configure one of these:

- **Ollama with llama3.2** -- local, private, free. Your conversation data never leaves your machine. Best for privacy-sensitive interviews.
- **OpenAI GPT-4o** -- cloud, highest quality suggestions. Best when you want the most accurate and nuanced AI assistance.

### 3. Select the Interview Scenario

![AI Scenarios settings panel](../../website/public/screenshots/Setting/Setting-AI%20Scenarios.png)

In NexQ Settings, select the **Interview** scenario. This configures the AI prompts to focus on interview-specific assistance: follow-up suggestions, answer framing, and conversational guidance.

### 4. Load Your Resume and Job Description

Use Context Intelligence (RAG) to give the AI background about you and the role:

1. Open the **Context Intelligence** panel in the Launcher
2. Click **Add Document**
3. Select your resume PDF, the job description, and any company research notes
4. Wait for indexing to complete (progress is shown in real-time)
5. The AI now has context about your background and the role you are interviewing for

See [Using Context Intelligence (RAG)](rag-context.md) for more details on document loading.

### Prepared answers

In **Settings > Prepared Answers**, click **Write stories from my CV** (paste the job offer first to aim them at it). NexQ writes about ten STAR stories (situation, task, action, result) from your documents, each with the questions it answers and keywords to glance at. Review and correct them before the interview: they say only what you validated.

During the meeting, when a question matches a story, the story shows at once above the AI's answer, before the AI has written anything. Close it with its × if it doesn't fit.

## Positioning the Overlay

When the meeting starts, the overlay window (500x700, always-on-top, transparent) appears. Position it carefully:

- Place it **near your webcam** but slightly to the side, so glancing at it looks natural
- Resize it to a comfortable reading size -- you should be able to read suggestions without squinting
- The overlay is transparent -- **only you can see it**. It will not appear in screen shares
- Use `Ctrl+B` to toggle between the launcher and overlay windows

## During the Interview

1. **Start the meeting** with `Ctrl+M` before the interview begins
2. NexQ transcribes both sides in real-time -- your mic captures your voice, and system audio captures the interviewer
3. **AI suggestions appear automatically** as the conversation flows. The AI analyzes the dialogue and provides contextual help
4. Press **Space** to manually trigger AI Assist at any moment for an instant analysis of the current conversation
5. Use the number keys for specific AI modes:
   - `1` -- What to Say (suggests your next response)
   - `2` -- Shorten (condenses the discussion)
   - `3` -- Follow-Up (generates follow-up questions)
   - `4` -- Recap (summarizes the conversation so far)
   - `5` -- Ask Question (free-form query)

Question detection recognizes `?` and `？`, French questions without a question mark (question words in any clause, after openers such as "Oui, deuxième question, comment tu…", "quel…" about you, "avez-vous", "question suivante"), common Chinese question words (such as 什么 / 什麼, 怎么 / 怎麼 and 哪), Chinese sentence endings 吗 / 嗎 and 呢, and Japanese question endings such as ですか, ますか and でしょうか. Suggestions ending in 吧 ("let's…"), phrases such as 没什么 or 无论如何, and a bare tag such as "Right?" or "You know?" are not treated as questions. These are heuristic signals: an ambiguous phrase can still be marked as a question.

Detected questions appear as cards in the overlay. Click the card you need to get an answer. To have the newest question answered automatically, turn on **Auto-Answer** in Settings > AI Actions.

For the fastest automatic answers, transcribe the interviewer with Cartesia or Deepgram Flux. Both tell NexQ when the interviewer has finished, so the answer starts right away instead of after 1.5 seconds of quiet (0.9 seconds after a question mark). If the interviewer keeps going after a pause, NexQ drops the answer it started and answers the complete question. Press `Space`, or click a question or an action, at any time to get your own answer instead.

Auto-Answer can also answer **whenever the interviewer stops talking**, not only questions (Settings > AI Actions > Auto-Answer > Answer when). Feedback such as "Très bonne réponse, huit sur dix" or "je regarde et je te fais un retour" is left alone. **Answer with: Say** writes the words to speak, in the first person.

### Reading while you speak

- **Compact box** (`Ctrl+Alt+K`, or the header button): the answer alone in a nearly invisible, framed box at the top of the screen. Drag it anywhere and resize it from its edges; it keeps its place. Double-click it to go back.
- **Reading pace**: answers start at the top and scroll gently at reading speed (− / + in the compact box) instead of jumping to the newest words. Hovering holds them still.
- **Cue card** (Settings > AI Actions > Cue card > Keywords first): each answer opens with 3 to 5 keywords shown large, then one short sentence you can say at once.
- **Read aloud** (`Ctrl+Alt+L`, or the headphones button): NexQ reads each sentence in your headset as soon as it is written. On the default output, Windows 10 2004 and later leave NexQ's own voice out of the interviewer's audio, so it is never transcribed as theirs.
- **Pause** (`Ctrl+Alt+P`): stops Auto-Answer and any reading; questions still show as cards to click.
- **What you already said** is struck out of the answer (keywords, list items, sentences), so what is left to say stands out.
- **Answer timer**: ⏱ shows how long you have been answering, amber from 90 seconds and red from 2 minutes.
- When the interviewer asks **"Avez-vous des questions pour nous ?"**, NexQ suggests questions to ask instead of an answer.
- A **prepared answer** that matches the question is read aloud at once (when reading aloud is on), instead of the AI's.

**Important**: Do not stare at the overlay. Glance at it naturally, the way you would glance at notes. Maintain eye contact with your camera.

### Before the interview

- **Check everything** in the Start Meeting window tests your microphone, the interviewer's audio, transcription, the AI, Ollama, your CV's indexing, prepared answers and the backup AI, and says how to fix what fails.
- **Practice** (graduation cap in the overlay header, during a meeting): NexQ plays the interviewer. It asks your prepared answers' questions aloud, listens to your answer, and once you pause scores it out of 10 with feedback and a better answer.
- **Without Internet**: if the online AI can't be reached, the answer is retried on a local Ollama model (for example `ollama pull qwen2.5:3b`), and answers stay local for a minute before trying online again.

## After the Interview

1. Press `Ctrl+M` to end the meeting
2. **Review the full transcript** in the Launcher -- every word from both sides is saved
3. Open the meeting's **Debrief** tab: each question, what you answered, the feedback you got, what to improve and a better answer. **Keep as a prepared answer** adds it to Settings > Prepared Answers for next time
4. Check the **AI Call Log** sidebar for all AI suggestions that were generated during the session
5. **Export or copy** the transcript for your notes or follow-up preparation
6. The meeting summary includes key discussion points, questions asked, and action items

## Tips

- **Do a dry run first.** Test your full setup (audio, STT, LLM, overlay position) before the real interview. Run a mock session with a friend or a YouTube video.
- **Mute desktop notifications.** Turn on Windows Focus Assist or Do Not Disturb mode to prevent popups during the interview.
- **Use headphones.** This is not optional -- speakers cause echo that feeds your voice back into the "Them" channel, confusing transcription.
- **Load focused documents.** A 2-page resume and a 1-page job description work better than dumping 50 pages of content. Smaller, relevant documents produce better AI context.
- **Test your audio devices.** Use the Test button in Settings > Audio to verify both mic and system audio are working before the interview starts.

## Next Steps

- [Audio Setup Guide](audio-setup.md) -- Detailed audio device configuration
- [AI Providers Guide](ai-providers.md) -- Compare all STT and LLM providers
- [Using Context Intelligence (RAG)](rag-context.md) -- Advanced document loading
- [Keyboard Shortcuts](keyboard-shortcuts.md) -- Full shortcut reference
