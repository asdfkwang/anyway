---
title: 'Kernel Lab Notes 4 — Rust Recommends It. Could I Apply It to the Kernel?'
description: 'Following the Rust Clippy borrow_as_ptr recommendation into kernel code: replacing intermediate references with raw borrows, then enabling the lint.'
lang: en
translationKey: rust-borrow-as-ptr
publishedAt: 2026-09-26
tags: [Linux, Kernel, Rust, Clippy, FFI, Upstream]
aiSummary: |
  - Motivation: The author found Rust Clippy's borrow_as_ptr recommendation and applied it to Linux kernel Rust code.
  - Recommendation: Use &raw const / &raw mut when a borrow would immediately be converted to a raw pointer, including implicit coercions at function arguments.
  - Rationale: Avoid an unnecessary intermediate reference and express pointer intent directly. Creating a reference requires validity, alignment, and aliasing conditions even if it is immediately converted to a pointer.
  - Scope: Cleanup of kernel Rust call sites, including DMA allocation output parameters, CPU masks, device properties, security interfaces, RBTree, and XArray. No functional change intended; this does not establish that every previous use was a bug.
  - Safety: Raw borrow syntax does not remove pointer lifetime, access validity, or FFI safety obligations.
  - Compatibility recorded in the patch: Raw borrow syntax stabilized in Rust 1.82; the kernel baseline used for this work had MSRV 1.85.
  - Commit 461027954f2a1d0f7a020b35fb983a77e09e3536: Replace intermediate borrows with raw borrows.
  - Commit b59da38005e9460b51b23d04d28401971906d402: Add -Wclippy::borrow_as_ptr to common Rust flags after cleaning up existing uses, so Clippy reports future occurrences.
  - Branch: https://github.com/asdfkwang/linux/tree/rust-borrow-as-ptr-v1
  - Recommendation source: https://rust-lang.github.io/rust-clippy/master/index.html#borrow_as_ptr
  - This entry does not report test results, mailing-list review, or upstream acceptance.

  ## v2 correction — 2026-09-26

  This addendum supersedes the original rationale where they conflict; the original article is preserved as a historical record.
  - Outcome: PR https://github.com/Rust-for-Linux/linux/pull/1257 was closed by the author after review. This v2 is an article addendum, not a revised patch submission.
  - Task origin: Rust-for-Linux issue https://github.com/Rust-for-Linux/linux/issues/1152 requested cleanup and lint enablement, but did not establish that every individual transformation was justified.
  - Concrete error: In core::ptr::read(&raw const *b), dereferencing the Box through Deref still creates a reference. Raw borrow syntax does not eliminate that step; the reviewer said the change obscured it without changing behavior.
  - Rationale rejected: The reviewed FFI calls still require appropriate alignment, initialization, and aliasing conditions. General raw-pointer construction properties did not justify replacing valid local borrows throughout the tree.
  - Evidence limit: The PR reported builds, Clippy checks, and a QEMU boot. Those observations do not establish the semantic benefit or necessity of each change.
  - AI collaboration failure: The AI generalized lint documentation without adequately checking actual call sites; the author relied on the explanation without sufficient independent verification.
  - Lesson: Trace concrete types, Deref behavior, and callee contracts; establish a specific problem or benefit before broad edits. Check original issue submission requirements, including mailing lists, Suggested-by, and an issue Link tag.
---

Last time, I spent a whole day getting a kernel to boot.

This time, code. Finally.

The starting point was a lint I found in the Rust Clippy documentation: [`borrow_as_ptr`](https://rust-lang.github.io/rust-clippy/master/index.html#borrow_as_ptr).

It recommends using `&raw const` or `&raw mut` when code creates a reference only to convert it straight into a raw pointer.

I decided to apply that recommendation to the kernel's Rust code.

## First, why does it recommend this?

The change described in the documentation looks like this:

```rust
let mut value = 0;
let ptr = &mut value as *mut i32;
```

Becomes:

```rust
let mut value = 0;
let ptr = &raw mut value;
```

The thing I ultimately need is a pointer. The first version creates an intermediate `&mut` reference. The second gets a raw pointer without creating that reference.

Clippy points to readability and avoiding unnecessary reference creation. In particular, creating a reference to an uninitialized value or an unaligned location can itself be a problem.

Oh. So this isn't just a shorter way to write it.

Rust references come with requirements: alignment, value validity, aliasing. Creating one briefly and then converting it to a pointer doesn't let me skip those requirements. The documentation leads into the [Rust Reference explanation of raw borrows](https://doc.rust-lang.org/reference/expressions/operator-expr.html#raw-borrow-operators).

Adding `&raw` doesn't mean I can do anything I like with the resulting pointer, either. Reads, writes, lifetimes, and the requirements of the C function still need checking.

## The same pattern was in the kernel

Rust code in the kernel calls C functions a lot. Sometimes it passes the address of a variable for C to write a result into. Sometimes it passes a pointer to a field in a structure.

There doesn't have to be an explicit `as *mut T`. If a function parameter expects a raw pointer, a reference passed to it can be converted at that point.

The DMA code in this change is one example.

I changed one of the arguments passed to `dma_alloc_attrs()` like this:

```diff
- &mut dma_addr,
+ &raw mut dma_addr,
```

That argument needs a pointer to the variable that will receive the DMA address.

The same pattern appeared in CPU mask allocation, device properties, security interfaces, RBTree, XArray, and other code. I collected those changes in the [first commit](https://github.com/asdfkwang/linux/commit/461027954f2a1d0f7a020b35fb983a77e09e3536).

Most of the diff consists of small, single-line edits.

Small changes, spread across quite a few files. It gives some sense of how often Rust and C meet in this code.

## That doesn't mean every old use was a bug

I want to keep this distinction clear.

If the existing code was working with a place where creating a reference was valid, using that expression didn't automatically make it a bug.

This work cleans up code to follow Clippy's recommendation. I also stated in the commit message that no functional change was intended.

Calling it “fixing a bunch of memory bugs” would be getting ahead of what the change actually establishes.

Where a raw pointer was needed, I replaced the expression that created an intermediate reference with one that directly expresses that intent.

The `unsafe` doesn't disappear, either. The safety conditions described around the existing code still matter.

## Can the kernel use this syntax?

Finding a recommendation isn't enough on its own.

The syntax also has to work with the Rust versions the kernel supports.

The patch's commit message records that `&raw` stabilized in Rust 1.82, while the kernel baseline for this work had a minimum Rust version of 1.85. With that baseline, the syntax didn't need a separate version-dependent path.

The edited lines are short. Explaining why the change is appropriate still takes a little more work.

## The second commit is one line

After cleaning up the existing uses, I added the lint to the common Rust build flags:

```makefile
-Wclippy::borrow_as_ptr
```

That one line is the [second commit](https://github.com/asdfkwang/linux/commit/b59da38005e9460b51b23d04d28401971906d402).

It lets Clippy flag the same pattern in future checks.

So the order is: clean up existing code, then enable the lint. I split updating the current uses and keeping the check enabled into two commits.

## From documentation to a patch this time

This was an exercise in finding a recommendation from Rust and applying it to kernel code.

The documentation has small examples. In the kernel, the pattern appears in DMA, data structures, and arguments used to receive results from C functions.

Reading the example and changing real call sites were different tasks. I had to follow why it was recommended, whether the kernel's supported Rust version could use it, and how to explain the intent of the change.

Last time, a day went into getting the boot environment working. This time, what remains is a collection of `&raw` changes and one line in the Makefile.

At least I've finally written a blog post about a patch after all those kernel configuration notes.

The work is on the [`rust-borrow-as-ptr-v1` branch](https://github.com/asdfkwang/linux/tree/rust-borrow-as-ptr-v1).

---

## v2 — I Trusted the AI's Explanation and Opened a PR (2026-09-26)

I'm leaving the original post above intact. It records how I understood the work before the PR review.

There were problems with that understanding.

I opened [PR #1257](https://github.com/Rust-for-Linux/linux/pull/1257) and received feedback. It caught me off guard. I'd followed the AI's recommendations and explanations, then written a blog post around them. But I couldn't properly justify the changes themselves.

Sigh. Getting rid of warnings and producing a good patch were different things.

### Having a starting point didn't make the conclusion right

There really was a related [Rust-for-Linux issue, #1152](https://github.com/Rust-for-Linux/linux/issues/1152). It asked for existing occurrences to be cleaned up and the borrow_as_ptr lint enabled.

The task had a basis. Whether each change I made was appropriate was a separate question.

Following the AI's explanation, I crossed that gap too easily. The AI applied Clippy's general rationale to actual kernel code without sufficiently checking whether it held for each change.

The result was a plausible explanation in both the PR and the post above. An explanation that read well had taken the place of verification.

### Writing &raw didn't remove every reference

One of the reviewed changes was this:

```diff
- let value = unsafe { core::ptr::read(&*b) };
+ let value = unsafe { core::ptr::read(&raw const *b) };
```

On the surface, it replaces a reference expression with a raw borrow. Following the explanation in the original post, it looks like an intermediate reference has been removed.

But `*b` goes through `Deref`, which already produces a reference. Putting `&raw const` outside it doesn't remove that step.

The reviewer pointed out that this hides the reference creation without changing the behavior. [Review comment](https://github.com/Rust-for-Linux/linux/pull/1257#discussion_r4111194685)

Oh. I'd been explaining the surface syntax.

The AI missed that distinction, and I didn't trace its explanation through what the code actually did. The earlier statement about obtaining a pointer without creating a reference cannot be applied across these changes as a blanket explanation.

### Saying FFI wasn't enough to justify the change

The reviewer also questioned why several borrows of local variables should be weakened to raw borrows. [Review](https://github.com/Rust-for-Linux/linux/pull/1257#pullrequestreview-5325723184)

My explanation emphasized the alignment, initialization, and aliasing requirements of an intermediate reference. The reviewer pointed out that the FFI calls in question still needed those conditions satisfied. [Follow-up comment](https://github.com/Rust-for-Linux/linux/pull/1257#issuecomment-5845864171)

I needed to distinguish constructing a raw pointer from passing it to a function that uses it. The general ability to avoid creating a reference didn't establish that a raw borrow was better at these call sites.

Concluding that raw borrows are useless would be another mistake. What I needed to establish was why one was appropriate in this particular code.

### What the tests showed, and what still needed explaining

The PR reported build, Clippy, and QEMU boot results.

Those results didn't establish the need for the changes. Removing warnings demonstrates that the warnings went away. Booting demonstrates that the tested environment booted. Neither, by itself, explains the semantics or benefit of each edit.

I blurred those things while accepting the AI's explanation. The code built, and the explanation sounded reasonable, so I moved on as though the rationale had also been checked.

The review exposed that missing step.

### I closed the PR. I'm keeping the post

I accepted the feedback and closed the PR. This v2 is an addendum to the original record, not a second version of the patch series.

The AI's explanation contained missing checks and incorrect generalizations. I submitted the PR under my name without sufficiently verifying that explanation. Both belong in this record.

Next time, I want to go beyond asking the AI for the edits. I'll start with a representative call site, follow the actual types, `Deref`, and the called function's requirements, and explain in my own words what is wrong with the old code. If nothing is wrong, I still need to ask what the change gains.

If I can't explain that, I'm not ready to write the PR description.

I also need to check the original issue's submission requirements. #1152 asked for mailing-list submission, a Suggested-by tag, and a Link tag pointing to the issue. Linking the Clippy documentation wasn't a substitute for reading the full request.

I was confused and embarrassed. Having already published the blog post made it worse.

Still, I don't want to quietly rewrite it as though I'd understood all this from the start. This is what I thought then. The review showed where it was wrong.

The AI could provide an explanation. Understanding and checking that explanation was still work I needed to do.
