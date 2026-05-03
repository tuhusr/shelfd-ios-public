# CODING CONSTITUTION

Read this entire document before writing a single line of code. These are not suggestions. These are mandatory rules that govern every change you make to this codebase — CSS, JavaScript, HTML, and any other file. No exceptions.

---

## SECTION 1: THE CORE PHILOSOPHY

The objective is to build a phenomenal website and app with the best quality code and production possible. Every line in every file must earn its place. If a line does not actively contribute to the current functionality of the application, it does not belong in the file. The codebase must read as if one skilled developer wrote it from start to finish with a clear, intentional plan — not as if hundreds of separate sessions each taped a new layer on top of the last.

There is no such thing as a safe workaround. There is no such thing as a quick patch. There is no such thing as "just override it for now." There is no such thing as "append it at the bottom to be safe." Every change you make must be a proper, clean, surgical change. If making that change properly requires rebuilding a component from scratch, then you rebuild it from scratch. If it requires refactoring an entire section of the file, then you refactor the entire section. If it requires rewriting a function, then you rewrite the function. The end result is what matters — clean, precise, minimal code that works correctly. The difficulty of getting there is irrelevant. It is what it is. Do the work.

---

## SECTION 2: NO APPENDING

Never add a new rule, function, or code block at the bottom of a file to override or replace something that already exists higher up in the same file. This is the single most important rule in this document.

If you are about to write a new CSS rule for a selector that already has a rule somewhere in the file, stop. Go find the original rule. Edit it in place. Change the values right there where the rule already lives. If the original rule is tangled up with other rules or components that make it difficult to edit cleanly, then untangle it. Refactor the block. Rebuild the component if necessary. But under no circumstances do you create a second definition of the same selector lower in the file.

The same applies to JavaScript. If a function already exists that handles a behavior, you modify that function. You do not write a new function with a slightly different name that does the same thing. You do not add an event listener that intercepts and overrides an existing event listener. You find the original, you understand what it does, and you change it to do what is now needed.

If you are ever unsure whether something already exists in the file, search the entire file first before writing anything new. This is mandatory. You must always search before you write.

---

## SECTION 3: NO PATCHING

A patch is when you add code specifically to counteract or work around other code in the same project. Patches are forbidden.

If I ask you to change the color of a title card, and there is an existing rule somewhere that is preventing that color from changing, you do not write a new rule with higher specificity or !important to force the color through. Instead, you find the rule that is causing the conflict, you understand why it exists, and you fix the conflict at its source. If fixing the conflict means modifying or removing the conflicting rule, you do that. If fixing the conflict means restructuring how the title card is styled entirely, you do that. If fixing the conflict means rebuilding the title card component from the ground up so it works cleanly, you do that.

The end goal is never "make it look right on screen by any means necessary." The end goal is "make it work correctly through clean, logical code that a developer can read and understand."

---

## SECTION 4: NO !important

Do not use !important. Period.

The only scenario where !important is acceptable is when overriding a third-party library or external stylesheet that you have no control over. For any code within this project — code that we wrote, code that we control — !important is never the answer.

If you feel the need to use !important, that means there is a specificity conflict somewhere in the CSS. Your job is to find that conflict and resolve it properly. This might mean reducing the specificity of an overly specific selector. It might mean reorganizing the order of rules. It might mean consolidating scattered rules into one clean block. Whatever it takes. But !important is not a tool — it is a symptom of a problem, and your job is to fix problems, not mask them.

---

## SECTION 5: NO LAYERING

Layering is when multiple rules, functions, or code blocks all target the same element or behavior, stacked on top of each other across different parts of the file. Each layer was added in a different session to adjust, fix, or override what the previous layer did. The result is a pile of competing code where only the last one wins and everything above it is dead weight.

This codebase has accumulated significant layering from previous AI sessions. Going forward, this stops completely.

Every selector gets ONE rule block. Every function gets ONE definition. Every behavior gets ONE handler. If you need to change how something works, you change it at its single point of definition. You do not add a second, third, or fourth definition somewhere else.

When you encounter existing layering while making a change — and you will — you are expected to clean it up as part of your change. Do not leave dead layers in place. If you are editing a component and you discover that it has three different rule blocks in three different parts of the CSS file, consolidate them into one block as part of your work. This is not optional extra credit. This is part of every change.

---

## SECTION 6: BEFORE YOU WRITE, AUDIT

Before making any change — no matter how small — you must first search the entire file for every existing instance of the selector, function, class name, ID, or component you are about to modify.

This means:
- If I ask you to change the styling of .card-title, you search the entire CSS file for every rule that contains .card-title before you touch anything. You search the JS file for any place that dynamically modifies .card-title. You search the HTML for how .card-title is used.
- If I ask you to change how a button behaves, you search for every event listener, every function, and every reference to that button across all files before you write a single line.

Once you have found everything, you assess the full picture. Then and only then do you make your change — with full awareness of everything that already exists, so your change is clean, complete, and does not create conflicts or duplicates.

If the file is too large to search in one pass, tell me. We will work through it section by section. But you do not skip the audit step. Ever.

---

## SECTION 7: REMOVE DEAD CODE

Dead code is any code that does not contribute to the current functionality of the application. This includes:

- CSS rules that are overridden by later rules and have no effect on the rendered page
- CSS selectors that target classes or IDs that no longer exist in the HTML and are never added by JavaScript
- JavaScript functions that are defined but never called from anywhere in any file
- JavaScript variables that are assigned but never read by any other line of code
- Event listeners attached to elements that no longer exist in the DOM
- Commented-out code blocks — if it is commented out, it is not running, and it does not belong in a production file. That is what version control is for.
- Version patch comments like "v42: fixed spacing" or "v163: layout update" — the code should speak for itself. Version history belongs in git, not in inline comments scattered throughout the file.
- Redundant vendor prefixes for CSS properties that all modern browsers support natively without them
- Unreachable code — code after a return statement, code inside conditions that can never be true, code in branches that are logically impossible to reach

When you encounter dead code while working on a change, remove it. Do not leave it for later. Do not comment it out "just in case." Remove it. If it turns out it was needed, it can be recovered from version control. Dead code in the file is not a safety net — it is clutter that makes the codebase harder to read, harder to maintain, and more likely to cause conflicts in future changes.

---

## SECTION 8: ONE SOURCE OF TRUTH

Every style, every behavior, every value should be defined in exactly one place.

- A color should not be hardcoded in 47 different CSS rules. It should be defined as a CSS custom property or variable and referenced everywhere it is used, so changing it means changing one line.
- A function that performs a specific task should exist once and be called from wherever it is needed. It should not be copy-pasted into three different places with minor variations.
- A component's styles should live in one consolidated block in the CSS, not scattered across 15 different locations in the file because 15 different sessions each added their own rules for it.

When you see violations of this principle while working, fix them. Consolidate. Centralize. Deduplicate.

---

## SECTION 9: IF IT REQUIRES A REBUILD, REBUILD

If I ask for a change and the cleanest way to implement it is to rebuild the component, section, or feature from scratch — do it. Do not try to preserve existing code out of caution if that code is messy, bloated, or architecturally wrong for what is now needed.

Tell me what you are about to do and why. Explain that the existing implementation needs to be rebuilt to properly support the change. Explain what will stay the same and what will change. Then do the rebuild.

I would rather have a component that was rebuilt cleanly from scratch and works perfectly than a component that has been patched 47 times and technically works but is held together with duct tape and !important declarations.

The goal is not to preserve old code. The goal is to have the best possible code at all times. If old code is standing in the way of that, it gets replaced.

---

## SECTION 10: COMMUNICATE COMPLEXITY

If a change I request is more complex than it appears on the surface, tell me before you start.

Explain:
- What the change actually requires under the hood
- What existing code is affected and why
- Whether it is a simple find-and-replace edit, a moderate refactor, or a full rebuild of a component or section
- What the risks are, if any
- How you plan to approach it

Then proceed with the work. Do not silently take shortcuts to avoid the complexity. Do not patch around the hard parts. Do the work properly and let me know what was involved.

If during the work you discover additional complexity you did not anticipate, stop and tell me. Do not start cutting corners because the task turned out to be bigger than expected. Explain what you found, explain what it means, and then do it right.

---

## SECTION 11: FILE HYGIENE

After every change, the files should be as clean or cleaner than they were before your change. The total line count of a file should stay roughly the same or decrease after a modification. If a change adds 30 lines of new code, there should be roughly 30 lines of old code that were removed, replaced, or consolidated.

If the file grows significantly from a single change, something is wrong. Either you appended instead of replacing, or you added complexity that was not necessary, or you failed to clean up the code that your change made obsolete.

The only exception is when genuinely new functionality is being added — a completely new feature, a new component, a new page. In that case growth is expected. But even then, the new code should be clean, minimal, and well-organized from the start — not bloated with unnecessary wrappers, redundant selectors, or over-engineered logic.

---

## SECTION 12: HOW TO HANDLE THEME VARIANTS

This project has multiple themes — a default dark mode, a light mode, and a true dark mode. When a style change is made, it must be applied correctly across all relevant themes.

However, this does not mean writing the same rule three times with three different body-class prefixes. Use logical structure:
- Define the base style once for the default theme
- Only add theme-specific overrides where the value actually differs between themes
- Never write a theme override that sets the exact same value as the base rule — that is dead code
- Never write a rule with a selector like body:not(.light-mode):not(.true-dark-mode) just to target the default theme — the default theme does not need a body-class qualifier because it is the default

If the current CSS has bloated theme handling where the same property is declared identically across multiple theme variants, consolidate it as part of your change.

---

## SECTION 13: THE AUDIT PASS

When I ask you to audit the codebase, follow this process:

1. Go through the file top to bottom, systematically, one file at a time
2. For every rule, function, or block you encounter, determine: Is this actively used? Is this the only definition? Is this the cleanest way to achieve what it does?
3. Produce a report with two sections:

**SAFE TO REMOVE** — Code that is provably dead, duplicated, or unused:
- For each item list: the file name, line number or line range, what it is, and a one-line proof of why it is safe to remove — what overrides it, or evidence that nothing in any file references it

**CAUTION** — Code that appears unused but has a possibility of being referenced dynamically or conditionally:
- For each item list: the file name, line number or line range, what it is, the specific reason it might still be needed — what dynamic JavaScript reference, edge case, or conditional path could invoke it — and your recommendation on whether to remove it, keep it, or refactor it

4. End with a summary: total dead lines found across all files, estimated file size reduction if all SAFE items are removed, and the top 5 worst offenders — the selectors or functions with the most duplication or the most dead overrides

5. Do not make any changes until I review the report and give explicit approval. Present the findings. Wait for my go-ahead. Then execute the cleanup in the order I approve.

---

## SECTION 14: ONGOING ACCOUNTABILITY

At the end of every change you make, include a brief summary:

- **What was changed**: What you added, modified, or created to fulfill my request
- **What was removed**: What dead code, duplicates, or overrides you cleaned up as part of this change
- **What was consolidated**: What scattered rules or functions you merged into single definitions
- **Net line change**: How many lines the file grew or shrank as a result of the total change

If the "what was removed" section is empty, explain why. There should almost always be something to clean up when working in an existing file. If there genuinely is nothing, that is fine — but you must explicitly confirm that you searched and found nothing to remove, rather than simply not looking.

If the net line change is a significant increase, explain why the growth was necessary and confirm that no existing code was left behind that should have been removed or replaced.

---

## FINAL WORD

The quality of this codebase is the priority above all else. Not speed. Not caution. Not preserving old code for safety. Not taking the easy path. Quality.

Every single change moves the code forward toward being cleaner, leaner, and more maintainable than it was before. No change should ever make the code worse, more bloated, or harder to work with than it was before you touched it.

If following these rules means a task takes longer, it takes longer. If it means rebuilding something that could have been patched in two lines, it gets rebuilt. If it means deleting 500 lines of accumulated patches to replace them with 50 clean lines, that is the right call every single time.

The objective is a phenomenal website and app with best-in-class code quality and production. Every decision you make serves that objective. No compromises.
