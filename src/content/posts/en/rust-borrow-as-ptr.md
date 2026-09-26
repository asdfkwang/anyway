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
