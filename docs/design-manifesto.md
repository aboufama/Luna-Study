# Luna design manifesto

**Quick, natural interaction. An active teaching board. Strict mastery rules underneath.**

This is the user's governing product direction, clarified October 2, 2026. It supersedes the earlier blanket restriction that whiteboards contain diagrams only.

## Conversation

The speaking tutor follows the student's intent and understanding. Explanations, questions, tangents, hints and topic changes should feel natural. The student should experience teaching rather than a visible scoring protocol. Lead on entry and automatically after indexing. Ask naturally about an unknown test date or useful priority, one question at a time; respect refusal and keep working. Hints are a deliberate button action with a limited allowance and cooldown. Clarifying the setup must stay easy, without turning into a loophole for giving the answer. Silence should earn one gentle check-in and then a resumable pause, with microphone and billing stopped. Keep first-response latency low; do retrieval, preparation, verification and drawing concurrently when correctness and actual measurements justify it. Do not make optional scheduling or question preparation block studying.

## The board

The board is a general teaching surface across subjects. Useful content includes diagrams, equations, worked steps, definitions, brief notes, tables, graphs, timelines, annotated sentences, relationships and highlights. Game theory is a benchmark source, never the boundary of the product.

The board follows the active explanation. Preserve useful objects during the same problem and apply small updates. Replace the scene when the problem changes. Hide it when it no longer supports the conversation, and reopen a still-relevant scene when needed. Do not leave an unrelated problem on screen. Do not redraw for its own sake or duplicate the spoken transcript without teaching value.

The current board is read-only, with a centered close control. An open spatial surface requires retained objects with stable identities and a coherent coordinate system. Use semantic layouts when they remove avoidable coordinate mistakes: computed flow connectors, numerical axes and exact nested phrase annotations. Generation syntax, renderer, scene state, visibility, selection and camera are separate responsibilities. Choose representations from measurements of correct, readable, editable output, not from syntax preference alone. A small generic command vocabulary may be useful; it must accommodate teaching text and notation as well as shapes.

## Mastery

Server rules control credit. A scored question has an exact identity, current source revision and verified evidence. Track attempts and assistance explicitly. Prevent duplicate awards, stale-source credit and unrelated answers being assigned to a previous question. Two independent grade checks must agree before applying a score. Board display and selection alone never award mastery. Record useful visual help in grading evidence.

The semantic judgment remains model-based; the credit rules are deterministic. A disputed or invalid grade receives no credit and a specific diagnostic reason. The system must not claim mastery or course coverage beyond what those rules establish.

## Evidence

Keep public decisions, timings, IDs, provider usage and scoring outcomes inspectable in debug views. Keep private answer keys, credentials and hidden reasoning out of public logs and speech. Distinguish simulated audio from measured ElevenLabs behavior, rendering from factual correctness, and public price estimates from billed charges.

Tests must exercise conversation → question → board → answer → verification → persisted score, including interruptions, assistance, source changes, problem changes and board visibility. Preserve failures and their fixes. Report what passed and what remains uncertain.
