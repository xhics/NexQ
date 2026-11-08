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

    let llm_arc = state.llm.as_ref().ok_or("LLM router not initialized")?;
    let (provider_arc, model) = {
        let router = llm_arc.lock().map_err(|_| "LLM lock poisoned")?;
        (
            router.get_provider().map_err(|e| format!("LLM not configured: {}", e))?,
            router.active_model().to_string(),
        )
    };

    // A silent stream: tokens go to this buffer, never to the overlay's answer.
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
        .map_err(|e| format!("Writing the stories failed: {}", e))?;

    let text = buffer.lock().map_err(|_| "Buffer lock poisoned".to_string())?.clone();
    if text.trim().is_empty() {
        return Err("The AI returned no stories".to_string());
    }
    log::info!("STAR stories written ({} chars)", text.len());
    Ok(text)
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
}
