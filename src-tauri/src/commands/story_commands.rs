//! Prepared answers: STAR stories drawn from the user's documents (CV) before
//! an interview, so a matching question shows a reviewed answer at once.

use tauri::{command, AppHandle, Manager};

use crate::state::AppState;

/// Most document text sent to write the stories.
const DOCUMENT_CHARS: usize = 40_000;

fn stories_prompt(documents: &str, job: &str, language: &str, count: u32) -> String {
    let job = if job.trim().is_empty() {
        String::new()
    } else {
        format!("\n\nThe job they are interviewing for:\n{job}")
    };
    format!(
        "You prepare a candidate for a job interview. From their documents below, write {count} STAR stories \
         (situation, task, action, result) they can tell, each drawn only from facts in the documents: never invent \
         an employer, project, figure or result.{job}\n\n\
         Write in {language}, in the first person, as the candidate would say it aloud: 45 to 60 seconds, plain \
         sentences, a measured result when the documents give one.\n\n\
         Return ONLY a JSON array, no code fences, no other text. Each item:\n\
         {{\"title\": short name of the story, \
         \"questions\": 4 to 6 interview questions this story answers (in {language}, as an interviewer would ask them), \
         \"keywords\": 3 to 5 keywords or figures to glance at, \
         \"answer\": the story to say}}\n\n\
         Documents:\n{documents}"
    )
}

/// Writes STAR stories from the attached documents (and the job, if given).
/// Returns the model's JSON text; the overlay parses and stores it.
#[command]
pub async fn generate_star_stories(
    app: AppHandle,
    job_description: Option<String>,
    language: Option<String>,
    count: Option<u32>,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    let documents = state
        .context
        .as_ref()
        .and_then(|c| c.lock().ok().map(|c| c.get_resources_context()))
        .unwrap_or_default();
    if documents.trim().is_empty() {
        return Err("Add your CV in Context first: the stories are drawn from it".to_string());
    }
    let documents: String = documents.chars().take(DOCUMENT_CHARS).collect();
    let language = language.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| "French".to_string());
    let prompt = stories_prompt(&documents, job_description.as_deref().unwrap_or(""), &language, count.unwrap_or(10).clamp(3, 20));

    let text = silent_completion(&app, prompt).await.map_err(|e| format!("Writing the stories failed: {e}"))?;
    log::info!("STAR stories written ({} chars)", text.len());
    Ok(text)
}

/// One prompt to the active model, its reply collected silently: never shown
/// as the overlay's answer, never logged as an AI action.
async fn silent_completion(app: &AppHandle, prompt: String) -> Result<String, String> {
    let state = app.state::<AppState>();
    let llm_arc = state.llm.as_ref().ok_or("LLM router not initialized")?;
    let (provider_arc, model) = {
        let router = llm_arc.lock().map_err(|_| "LLM lock poisoned")?;
        (
            router.get_provider().map_err(|e| format!("LLM not configured: {}", e))?,
            router.active_model().to_string(),
        )
    };
    let buffer = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let sink_buffer = buffer.clone();
    let sink: crate::llm::provider::TokenSink = std::sync::Arc::new(move |token: &str| {
        if let Ok(mut buf) = sink_buffer.lock() {
            buf.push_str(token);
        }
    });
    let params = crate::llm::provider::GenerationParams {
        request_id: Some(uuid::Uuid::new_v4().to_string()),
        silent: true,
        ..Default::default()
    };
    let messages = vec![crate::llm::provider::LLMMessage { role: "user".to_string(), content: prompt }];
    let provider = provider_arc.lock().await;
    provider
        .stream_completion(messages, &model, params, app.clone(), Some(sink))
        .await
        .map_err(|e| e.to_string())?;
    let text = buffer.lock().map_err(|_| "Buffer lock poisoned".to_string())?.clone();
    if text.trim().is_empty() {
        return Err("The AI returned nothing".to_string());
    }
    Ok(text)
}

/// Most transcript text sent for a debrief.
const TRANSCRIPT_CHARS: usize = 60_000;

fn debrief_prompt(transcript: &str, language: &str) -> String {
    format!(
        "Below is the transcript of a job interview. \"Them\" is the interviewer, \"You\" is the candidate. \
         Write a debrief for the candidate, in {language}.\n\n\
         For each real question the interviewer asked (skip small talk), give: the question; a one-sentence \
         summary of what the candidate answered; the interviewer's score or feedback if they gave one (else null); \
         2 or 3 concrete points to improve; and a better answer the candidate could give next time, in the first \
         person, 45 to 60 seconds aloud, using only facts the candidate stated or that are plainly implied: never \
         invent an employer, project or figure.\n\n\
         Return ONLY a JSON array, no code fences, no other text. Each item: \
         {{\"question\": string, \"answered\": string, \"feedback\": string or null, \
         \"improve\": [string], \"better\": string}}\n\n\
         Transcript:\n{transcript}"
    )
}

/// A debrief of an interview: each question, what you answered, the feedback
/// given, what to improve and a better answer. Returns the model's JSON text.
#[command]
pub async fn generate_interview_debrief(app: AppHandle, transcript: String, language: Option<String>) -> Result<String, String> {
    if transcript.trim().is_empty() {
        return Err("This meeting has no transcript".to_string());
    }
    let transcript: String = transcript.chars().take(TRANSCRIPT_CHARS).collect();
    let language = language.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| "French".to_string());
    let text = silent_completion(&app, debrief_prompt(&transcript, &language))
        .await
        .map_err(|e| format!("Writing the debrief failed: {e}"))?;
    log::info!("Interview debrief written ({} chars)", text.len());
    Ok(text)
}

fn practice_prompt(question: &str, answer: &str, reference: &str, language: &str) -> String {
    let reference = if reference.trim().is_empty() {
        String::new()
    } else {
        format!("\n\nThe answer the candidate prepared (for reference, not to copy):\n{reference}")
    };
    format!(
        "You are a demanding but fair interviewer for a senior role. Score the candidate's spoken answer to your \
         question out of 10 and coach them, in {language}, using tu.\n\n\
         Question: {question}\n\nTheir answer (transcribed speech, may contain recognition errors):\n{answer}{reference}\n\n\
         Return ONLY a JSON object, no code fences, no other text: \
         {{\"score\": number from 0 to 10, \"feedback\": one or two sentences on what worked and what didn't, \
         \"improve\": [2 or 3 concrete points], \"better\": a better answer in the first person, 45 to 60 seconds \
         aloud, using only facts from their answer or the prepared one}}"
    )
}

/// Scores a practice answer (Practice mode): score, feedback, what to improve
/// and a better answer. Returns the model's JSON text.
#[command]
pub async fn score_practice_answer(
    app: AppHandle,
    question: String,
    answer: String,
    reference: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    if answer.trim().is_empty() {
        return Err("No answer was heard".to_string());
    }
    let language = language.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| "French".to_string());
    let prompt = practice_prompt(&question, &answer, reference.as_deref().unwrap_or(""), &language);
    silent_completion(&app, prompt).await.map_err(|e| format!("Scoring the answer failed: {e}"))
}

/// One answer as the AI wrote it and as the user rewrote it.
#[derive(serde::Deserialize)]
pub struct StyleEdit {
    pub before: String,
    pub after: String,
}

/// Most edits sent to learn a style from.
const STYLE_EDITS: usize = 12;

fn style_prompt(edits: &[StyleEdit], language: &str) -> String {
    let pairs: String = edits
        .iter()
        .take(STYLE_EDITS)
        .enumerate()
        .map(|(i, e)| format!("--- Edit {}\nWritten by the AI:\n{}\n\nRewritten by the candidate:\n{}\n", i + 1, e.before, e.after))
        .collect();
    format!(
        "A job candidate rewrote answers an AI wrote for them to say aloud in interviews. From their edits, infer \
         how they want their answers written: tone, tu or vous, length, structure, vocabulary, figures, what they \
         remove or add. Write 3 to 6 short, general rules in {language}, as instructions to the AI (\"Utilise…\", \
         \"Évite…\"). Each rule must apply to any answer, never mention a specific project, employer or fact, and \
         come from a pattern seen in the edits, not a guess.\n\n\
         Return ONLY the rules, one per line, each starting with \"- \".\n\n{pairs}"
    )
}

/// Rules describing how you want answers written, inferred from your edits to
/// AI-written answers. Returns them one per line ("- …") for you to review.
#[command]
pub async fn learn_style(app: AppHandle, edits: Vec<StyleEdit>, language: Option<String>) -> Result<String, String> {
    if edits.is_empty() {
        return Err("Edit a few prepared answers first: your style is learnt from your edits".to_string());
    }
    let language = language.filter(|l| !l.trim().is_empty()).unwrap_or_else(|| "French".to_string());
    let text = silent_completion(&app, style_prompt(&edits, &language))
        .await
        .map_err(|e| format!("Learning your style failed: {e}"))?;
    let rules: Vec<&str> = text.lines().map(str::trim).filter(|l| l.starts_with("- ")).collect();
    if rules.is_empty() {
        return Err("The AI found no rule in your edits".to_string());
    }
    log::info!("Style learnt from {} edits: {} rules", edits.len().min(STYLE_EDITS), rules.len());
    Ok(rules.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_forbids_invented_facts_and_names_the_job_only_when_given() {
        let with_job = stories_prompt("CV", "Architecte GenAI", "French", 8);
        assert!(with_job.contains("never invent"));
        assert!(with_job.contains("Architecte GenAI"));
        assert!(with_job.contains("write 8 STAR stories"));
        assert!(!stories_prompt("CV", "  ", "French", 8).contains("interviewing for"));
    }

    #[test]
    fn the_practice_prompt_gives_the_reference_only_when_there_is_one() {
        let with = practice_prompt("Parle-moi d'un échec", "Un projet RAG", "Ma réponse préparée", "French");
        assert!(with.contains("Question: Parle-moi d'un échec"));
        assert!(with.contains("Ma réponse préparée"));
        assert!(!practice_prompt("Q", "A", " ", "French").contains("prepared (for reference"));
    }

    #[test]
    fn the_style_prompt_shows_each_edit_and_asks_for_general_rules() {
        let edits = vec![StyleEdit { before: "Nous avons mis en place".into(), after: "J'ai mis en place".into() }];
        let prompt = style_prompt(&edits, "French");
        assert!(prompt.contains("Written by the AI:\nNous avons mis en place"));
        assert!(prompt.contains("Rewritten by the candidate:\nJ'ai mis en place"));
        assert!(prompt.contains("never mention a specific project"));
        let many: Vec<StyleEdit> = (0..20).map(|i| StyleEdit { before: format!("b{i}"), after: format!("a{i}") }).collect();
        assert_eq!(style_prompt(&many, "French").matches("--- Edit").count(), STYLE_EDITS);
    }

    #[test]
    fn the_debrief_prompt_names_who_is_who_and_forbids_invented_facts() {
        let prompt = debrief_prompt("Them: Parle-moi de toi", "French");
        assert!(prompt.contains("\"Them\" is the interviewer"));
        assert!(prompt.contains("never invent"));
        assert!(prompt.ends_with("Them: Parle-moi de toi"));
    }
}
