// Sub-PRD 6: Question detection
// Layer 1: Regex (sentences ending ?, interrogative words)
// Layer 2: Interview-specific contextual patterns

use serde::{Deserialize, Serialize};

/// A detected question from the transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedQuestion {
    pub text: String,
    pub confidence: f64,
    pub timestamp_ms: u64,
    pub source: String,
}

/// Detects questions in transcript text using two layers:
/// - Layer 1: Regex patterns (question marks, interrogative words)
/// - Layer 2: Interview-specific contextual patterns
pub struct QuestionDetector;

/// Interrogative words that commonly start questions.
const INTERROGATIVE_STARTERS: &[&str] = &[
    "what", "why", "how", "when", "where", "who", "which",
    "can", "could", "would", "should",
    "do", "does", "is", "are", "will", "have", "has",
    "tell",
];

/// Common Chinese question words, including simplified and traditional forms.
const CHINESE_QUESTION_WORDS: &[&str] = &[
    "什么", "什麼", "怎么", "怎麼", "为什么", "為什麼",
    "哪", "谁", "誰", "多少", "如何",
];

/// Phrases where a Chinese question word means "any" or "no matter" rather
/// than asking (没什么问题 "no problem", 无论如何 "no matter what").
const CHINESE_NON_QUESTION_PHRASES: &[&str] = &[
    "没什么", "沒什麼", "什么都", "什麼都", "什么也", "什麼也",
    "不怎么", "不怎麼", "哪怕", "谁都", "誰都", "谁也", "誰也",
    "无论", "無論", "不管", "多多少少",
];

/// Japanese question endings. A bare か also ends ordinary words
/// (静か "quiet", 確か "surely", とか "and so on"), so it isn't enough alone.
const JAPANESE_QUESTION_ENDINGS: &[&str] = &[
    "ですか", "ますか", "ませんか", "でしたか", "ましたか",
    "でしょうか", "ましょうか", "のか", "ないか",
];

/// A tag on its own ("Right?", "You know?") asks nothing the AI could answer.
const TAG_QUESTIONS: &[&str] = &[
    "right", "okay", "ok", "yeah", "yep", "yes", "no", "nope", "sure", "correct", "true", "really",
    "agreed", "alright", "all right", "huh", "hmm", "hm", "eh", "see", "you see", "you know",
    "isn't it", "sorry", "pardon", "hello", "cool", "good",
    "d'accord", "hein", "voilà", "c'est ça", "n'est-ce pas", "oui", "non", "vraiment", "allô", "bon",
    "tu vois", "vous voyez", "ça va", "c'est bon", "tu sais", "vous savez",
];

/// Words that can come before a tag ("So, right?").
const TAG_LEAD_INS: &[&str] = &[
    "and", "so", "but", "well", "oh", "um", "uh", "okay", "ok", "yeah", "yes", "no",
    "et", "donc", "mais", "alors", "bon", "euh", "oui", "non", "ah",
];

// French question signals, kept in step with src/overlay/QuestionDetector.tsx.
// French STT rarely writes the question mark, and spoken questions come after
// openers ("Oui, deuxième question, comment tu…"), so each clause is checked.

/// Words that ask at the start of a clause, after openers like "Oui," or "Alors,".
const FRENCH_CLAUSE_STARTERS: &[&str] = &[
    "comment", "pourquoi", "combien", "lequel", "laquelle", "lesquels", "lesquelles",
    "parlez-moi", "parle-moi", "racontez-moi", "raconte-moi", "expliquez-moi", "explique-moi", "expliquez", "explique",
    "décrivez", "décrivez-moi", "décris", "décris-moi", "dites-moi", "dis-moi", "présentez-vous", "présente-toi",
    "donnez-moi", "donne-moi", "citez-moi", "cite-moi", "citez", "cite",
];

/// Ask only as the sentence's first word: inside a sentence they link ("un projet où…").
const FRENCH_FIRST_WORD_STARTERS: &[&str] = &["où", "d'où", "qui", "quoi"];

/// "Quel…" asks when it is about you ("quelle décision tu as prise", not "quelle chance").
const FRENCH_QUEL: &[&str] = &["quel", "quelle", "quels", "quelles"];
const FRENCH_YOU: &[&str] = &["tu", "toi", "ton", "ta", "tes", "vous", "votre", "vos"];
const FRENCH_QUEL_VERBS: &[&str] = &[
    "est", "sont", "serait", "seraient", "était", "étaient", "a été", "ont été", "sera", "seront",
];

const FRENCH_PATTERNS: &[&str] = &[
    "est-ce que", "est-ce qu'", "qu'est-ce", "un exemple concret", "un exemple précis",
    "nouvelle question", "question suivante", "prochaine question", "première question", "deuxième question",
    "troisième question", "quatrième question", "cinquième question", "dernière question", "autre question",
    "j'aimerais savoir", "je voudrais savoir", "j'aimerais comprendre", "je voudrais comprendre",
    "je vous écoute", "je t'écoute",
];

const FRENCH_LEAD_INS: &[&str] = &["et", "mais", "donc", "alors", "puis", "ok", "okay", "bon", "oui", "ouais", "bien"];

/// Inverted subject pronouns ("avez-vous", "pensez-vous", "a-t-il").
const FRENCH_INVERSIONS: &[&str] = &["-vous", "-tu", "-t-il", "-t-elle", "-t-on"];

/// Interview-specific patterns that indicate a question or prompt.
const INTERVIEW_PATTERNS: &[&str] = &[
    "walk me through",
    "describe a time",
    "tell me about",
    "what would you do",
    "how do you handle",
    "give me an example",
    "explain how",
    "what's your experience with",
    "what is your experience with",
    "can you walk me through",
    "can you describe",
    "can you explain",
    "can you tell me",
    "talk about a time",
    "share an example",
    "how would you",
    "how have you",
    "what approach would you",
    "what's your approach to",
    "what is your approach to",
];

impl QuestionDetector {
    pub fn new() -> Self {
        Self
    }

    /// Detect questions in the given text.
    /// Returns a list of detected questions with confidence scores.
    pub fn detect_questions(&self, text: &str, timestamp_ms: u64, source: &str) -> Vec<DetectedQuestion> {
        let mut questions: Vec<DetectedQuestion> = Vec::new();

        // Split text into sentences
        let sentences = split_sentences(text);

        for sentence in &sentences {
            let trimmed = sentence.trim();
            // Short questions such as "谁？" and "Why?" are valid, but
            // punctuation-only fragments are not.
            if !trimmed.chars().any(char::is_alphanumeric) || is_tag_question(trimmed) {
                continue;
            }

            let mut confidence: f64 = 0.0;

            // Layer 1: Check for question mark
            if trimmed.ends_with(['?', '？']) {
                confidence = 0.95;
            }

            // STT may omit question marks or use a full stop instead.
            if is_cjk_question(trimmed) || is_french_question(trimmed) {
                confidence = confidence.max(0.6);
            }

            // Layer 1: Check for interrogative word starters
            if confidence < 0.5 {
                let lower = trimmed.to_lowercase();
                let first_word = lower.split_whitespace().next().unwrap_or("");
                if INTERROGATIVE_STARTERS.contains(&first_word) {
                    // Interrogative word at start without question mark
                    confidence = confidence.max(0.6);
                }
            }

            // Layer 2: Check for interview-specific patterns
            let lower = trimmed.to_lowercase();
            for pattern in INTERVIEW_PATTERNS {
                if lower.contains(pattern) {
                    // Interview patterns are strong signals
                    confidence = confidence.max(0.85);
                    break;
                }
            }

            // Only include if confidence is above threshold
            if confidence >= 0.5 {
                questions.push(DetectedQuestion {
                    text: trimmed.to_string(),
                    confidence,
                    timestamp_ms,
                    source: source.to_string(),
                });
            }
        }

        questions
    }
}

/// Whether a sentence is only a tag, with or without words leading into it.
fn is_tag_question(sentence: &str) -> bool {
    let lower = sentence.to_lowercase().replace('’', "'");
    let words: Vec<&str> = lower
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '.' | '?' | '？' | '!' | '…'))
        .filter(|word| !word.is_empty())
        .collect();
    let lead_ins = words
        .iter()
        .take(words.len().saturating_sub(1))
        .take_while(|word| TAG_LEAD_INS.contains(word))
        .count();
    TAG_QUESTIONS.contains(&words[lead_ins..].join(" ").as_str())
}

/// Chinese and Japanese question signals for a sentence without a question
/// mark. Question particles count only at the end of the sentence; Chinese
/// question words need no whitespace boundaries. Auto-Trigger answers detected
/// questions, so suggestions such as 我们开始吧 ("let's start") are left out.
fn is_cjk_question(sentence: &str) -> bool {
    let body = sentence.trim_end_matches(['.', '!', '。', '！', '…']);
    body.ends_with(['吗', '嗎', '呢'])
        || JAPANESE_QUESTION_ENDINGS.iter().any(|ending| body.ends_with(ending))
        || (CHINESE_QUESTION_WORDS.iter().any(|word| body.contains(word))
            && !CHINESE_NON_QUESTION_PHRASES.iter().any(|phrase| body.contains(phrase)))
}

/// Whether a clause asks: its first word after openers, or "quel…" about you.
fn french_clause_asks(clause: &str, first: bool) -> bool {
    let mut words: Vec<&str> = clause.split_whitespace().collect();
    while words.len() > 1 && FRENCH_LEAD_INS.contains(&words[0]) {
        words.remove(0);
    }
    let head = words.first().copied().unwrap_or("");
    if FRENCH_CLAUSE_STARTERS.contains(&head) || (first && FRENCH_FIRST_WORD_STARTERS.contains(&head)) {
        return true;
    }
    if FRENCH_QUEL.contains(&head) {
        let rest = words[1..].join(" ");
        let about_you = words[1..].iter().any(|word| {
            let word = word.trim_end_matches(['.', ',', ';', ':', '!', '?']);
            FRENCH_YOU.contains(&word) || word.starts_with("t'")
        });
        let defining = FRENCH_QUEL_VERBS.iter().any(|verb| rest == *verb || rest.starts_with(&format!("{verb} ")));
        return about_you || defining;
    }
    false
}

/// French question words for a sentence without a question mark.
fn is_french_question(sentence: &str) -> bool {
    let lower = sentence.to_lowercase().replace('’', "'");
    let text = lower.trim_end_matches(['.', '!', '…']);
    let inverted = text.split_whitespace().any(|word| {
        let word = word.trim_end_matches(',');
        word != "rendez-vous"
            && FRENCH_INVERSIONS.iter().any(|pronoun| {
                word.strip_suffix(pronoun)
                    .is_some_and(|verb| !verb.is_empty() && verb.chars().all(char::is_alphabetic))
            })
    });
    inverted
        || FRENCH_PATTERNS.iter().any(|pattern| text.contains(pattern))
        || text
            .split([',', ';', ':'])
            .enumerate()
            .any(|(i, clause)| french_clause_asks(clause.trim(), i == 0))
}

/// Split text into sentences using common sentence terminators.
fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if matches!(ch, '.' | '?' | '!' | '。' | '？' | '！' | '\n') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }

    // Don't forget the last sentence fragment (may not end with punctuation)
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }

    sentences
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_full_width_and_short_questions() {
        for text in ["计划完成了？", "準備できました？", "谁？", "Why?"] {
            let questions = QuestionDetector::new().detect_questions(text, 42, "Them");
            assert_eq!(questions.len(), 1, "{text}");
            assert_eq!(questions[0].text, text);
            assert_eq!(questions[0].confidence, 0.95);
            assert_eq!(questions[0].timestamp_ms, 42);
            assert_eq!(questions[0].source, "Them");
        }
    }

    #[test]
    fn skips_a_bare_tag_but_keeps_short_questions() {
        for text in ["Right?", "right?", "Okay?", "Yeah, right?", "So, right?", "You know?", "Isn't it?", "Really?"] {
            let questions = QuestionDetector::new().detect_questions(text, 0, "Them");
            assert!(questions.is_empty(), "{text}");
        }
        for text in ["Why?", "Is that right?", "Right now?", "And you?"] {
            let questions = QuestionDetector::new().detect_questions(text, 0, "Them");
            assert_eq!(questions.len(), 1, "{text}");
        }
    }

    #[test]
    fn a_trailing_tag_leaves_the_question_before_it() {
        let questions = QuestionDetector::new().detect_questions(
            "Is that what you were thinking about? Right?", 0, "Them",
        );
        assert_eq!(
            questions.iter().map(|q| q.text.as_str()).collect::<Vec<_>>(),
            ["Is that what you were thinking about?"]
        );
    }

    #[test]
    fn detects_chinese_questions_without_question_marks() {
        for text in [
            "准备好了吗", "準備好了嗎。", "你的计划呢",
            "这是什么", "這是什麼", "这个问题怎么解决", "這個問題怎麼解決",
            "为什么需要重试", "為什麼需要重試", "哪天发布", "选哪个方案",
            "谁来负责", "誰來負責", "需要多少时间", "如何开始",
        ] {
            let questions = QuestionDetector::new().detect_questions(text, 0, "You");
            assert_eq!(questions.len(), 1, "{text}");
            assert_eq!(questions[0].confidence, 0.6, "{text}");
        }
    }

    #[test]
    fn detects_japanese_question_endings() {
        for text in ["準備できましたか", "いつ始めますか。", "これでよいですか！", "一緒に行きませんか", "どうでしょうか"] {
            let questions = QuestionDetector::new().detect_questions(text, 0, "Them");
            assert_eq!(questions.len(), 1, "{text}");
            assert_eq!(questions[0].confidence, 0.6, "{text}");
        }
    }

    #[test]
    fn separates_cjk_sentences_and_unpunctuated_lines() {
        let questions = QuestionDetector::new().detect_questions(
            "今天讨论进度。计划完成了吗？谢谢！\n準備できましたか\nCan we start?", 7, "Them",
        );
        assert_eq!(
            questions.iter().map(|q| q.text.as_str()).collect::<Vec<_>>(),
            ["计划完成了吗？", "準備できましたか", "Can we start?"]
        );
    }

    #[test]
    fn detects_french_questions_without_question_marks() {
        for text in [
            "Parlez-moi de votre dernier projet", "Pouvez-vous me décrire votre rôle",
            "Qu'est-ce qui vous motive", "Qu’est-ce que vous attendez de ce poste",
            "Comment gérez-vous les conflits", "Quelle est votre plus grande faiblesse",
            "Avez-vous déjà travaillé avec UiPath", "Et vous, pensez-vous rester longtemps",
            "Est-ce que vous connaissez Python", "Où vous voyez-vous dans cinq ans",
        ] {
            let questions = QuestionDetector::new().detect_questions(text, 0, "Them");
            assert_eq!(questions.len(), 1, "{text}");
            assert_eq!(questions[0].confidence, 0.6, "{text}");
        }
        for text in [
            "Quand j'étais chez Capgemini, j'ai mené ce projet.", "Quelle chance d'avoir cette équipe",
            "On a fixé un rendez-vous demain", "Merci beaucoup pour votre temps.",
            "D'accord ?", "Hein ?", "Bon, d'accord ?", "C’est ça ?",
        ] {
            assert!(QuestionDetector::new().detect_questions(text, 0, "Them").is_empty(), "{text}");
        }
    }

    #[test]
    fn detects_spoken_french_questions_after_openers() {
        for text in [
            "Oui, deuxième question, comment tu t'assures que tes systèmes restent face aux pannes d'API",
            "Ok, et si tu partais quand même sur l'agent, quel garde-fou concret tu mettais pour limiter les dérives",
            "Alors, décris une fois où tu as dû choisir entre un workflow classique et une approche agentique",
            "Oui bien sûr, alors raconte-moi une situation où tu as dû reprendre une architecture existante",
            "Quelle décision tu as prise que tu as gardé",
            "Et pourquoi ce choix plutôt qu'un autre",
        ] {
            assert_eq!(QuestionDetector::new().detect_questions(text, 0, "Them").len(), 1, "{text}");
        }
        for text in [
            "Neuf sur dix, tu as une vraie approche d'architecte senior.",
            "Oui, donc tu disais quand le processus est déterministe, tu gardes le workflow classique.",
            "Tu expliques bien le contexte, l'échec et les leçons.",
            "Je travaille sur un projet où l'on automatise la facturation",
            "Quelle estime pour cette équipe",
        ] {
            assert!(QuestionDetector::new().detect_questions(text, 0, "Them").is_empty(), "{text}");
        }
    }

    #[test]
    fn preserves_english_confidence_and_ignores_statements() {
        for (text, confidence) in [
            ("What is the plan?", 0.95),
            ("How can we start", 0.6),
            ("Tell me about your last project", 0.85),
        ] {
            let questions = QuestionDetector::new().detect_questions(text, 0, "Them");
            assert_eq!(questions.len(), 1, "{text}");
            assert_eq!(questions[0].confidence, confidence);
        }
        for text in [
            "", "   ", "！？??...", "会议结束了。谢谢大家！", "会議は終了しました。", "The meeting is over.",
            // Suggestions and indefinite uses of question words are statements.
            "我们开始吧", "好，那就这样吧。", "没什么问题", "我什么都可以", "无论如何都要按时完成",
            "不管怎么样，我们明天发布", "哪怕晚一点也没关系",
            // Words that merely end in か.
            "とても静か", "確か", "コーヒーとか",
        ] {
            assert!(QuestionDetector::new().detect_questions(text, 0, "Them").is_empty(), "{text}");
        }
    }
}
