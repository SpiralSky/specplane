---
id: architecture/agent-skills
title: Agent skills
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 380a893a01aba93dd6694e9a0aab9e67cef0615f
  note: approved by the LLM, not a human, under the user's 2026-11-09 delegation (hand-edited because the CLI cannot read this format; see docs/work-records/2026-11-09-spec-format.md)
  fingerprint: spec-v3:sha256:f554d210a575ff6e9aa95a722fc5d9d74a04e0f86cbfc57d840897d204c222df
  cited:
    harness R14: sec-v1:sha256:c55f58fe1dea4db1a9b76c56fc683dad6c33fb43da8bca5e125c7a55e7ddd0ad
    harness R18: sec-v1:sha256:0c8116d05d996ead110755d790e9104e59771c4ddae5ca1617937dde73fb724b
    harness R19: sec-v1:sha256:7e45db4dfc74a30d2859791eeeec669a8de13a1f798926f854b1047ed29aa8f2
    harness R19.1: sec-v1:sha256:c49acd2d00105a611f568a8e794c4475a78b2f3a21a0156e62cf42f96ad31315
    harness R19.2: sec-v1:sha256:550ccd8601b3b32ad6b4325f4d23a384f1deee3fb02b1ae338d399b39f30879d
    harness R20: sec-v1:sha256:5bee5d75e8ce4a7bab24183624e0a504c6246f286a07ad4181d8b19f6aeaab87
    harness R20.1: sec-v1:sha256:2f166dfa1eda431207a711285a5af38a6a6c3ce0f7948749dfd45cf487854978
    harness R26: sec-v1:sha256:f5c286cb39301132e40ce03bb2083729e53624142926704dd207cd16e1c16d2c
    harness R26.1: sec-v1:sha256:3f38f3ccb5b2dabb05a43a4eb9fd9c97bcf5c992ddaf1be18f0a9229fc10b34d
    harness R26.2: sec-v1:sha256:3be84cef103dadeb62b3934ebebeccd20189988a6331ef8aa447635de1f03c70
    harness R34: sec-v1:sha256:c99f8eb6bee676df8f3cda14e355d27fbf8d41396e0b8af6b02acb12656f5ef3
    harness R35: sec-v1:sha256:8b1e737add27eec7e74590dc6f9ebcc4783eb590989cf0a6fe385d3318509673
    harness R35.1: sec-v1:sha256:ad8d4e7fe9a3b9752ae87aebd0f898c61a5b6b2cb6765bed056ffa7fb8a82ce3
    harness R47: sec-v1:sha256:00141da5fe320b391ee24b77a44a26f4771c990c0fc6df86dc6bb6bad7596471
    harness §2: sec-v1:sha256:eefbd6e7b229444096ca07b84f193102a1583c6fefa9a2cc93f290f1d92746c2
    harness §3: sec-v1:sha256:45f449d3ef356b5aad71d6bd05ecb2c2dfd5b35b26ddfe84b47b3ab61023d6d0
    harness R21: sec-v1:sha256:29265391e74a2e38b2e0d878e9ed8777cc8c9604a0f7f8a292e5ae1ece5bb7a4
    harness R38: sec-v1:sha256:b07470de151d828b12dcf666d5d17ba92823d0efda29d6eb7af0e7f8bfd206fb
    steering R22: sec-v1:sha256:d9f839de1060ffe4c0024af136b6c2e35bf75114240139440381280fb00bfc5a
    steering R23: sec-v1:sha256:e9813d1b21b35b1f55a819fc307219a95c0c7e3a3a1edeacd694fc2084eecffb
    steering R51: sec-v1:sha256:b3c2c9caabca37dd96851061c01a1d38acbb1c1ecfb56c76a8f674ccd8f86ae7
    steering R59: sec-v1:sha256:7078d03a4c2a8767271e37f7c1b6ed4551ee563aa732399d8e620e759d99deb4
    steering R59.1: sec-v1:sha256:51c5ce271e04fa5e30d6868c79bb729f9150cbcfc9b225452e358924bf74fff4
    plan-execution R27: sec-v1:sha256:16be697fca95202f6580e27147551a2774b7edabed2ca7abceb3656e707507db
    plan-execution R27.1: sec-v1:sha256:eb372e0c9bc8e7d6356a33d6dfcea88ad37c6e2adec2470a2b7fa7464efc6783
    plan-execution R27.2: sec-v1:sha256:ad9223052ac0145b15b4094fb5d03818a61a74b3eacbe4320cab3a8d60cc94b3
    plan-execution R27.3: sec-v1:sha256:35299fcdf7de2e8cc7d22a5adef82d653de1f42673a71f7167c1ede4f08e2c38
    plan-execution R27.4: sec-v1:sha256:3d7b10b203e5ad988fa6007ece52ab79d06327886b8fa423411b32493e3fc95c
    plan-execution R27.5: sec-v1:sha256:3a43aca88d2824049cc58660daae61614ab24c1132330cca61f1b2976b622b74
    plan-execution R27.5.1: sec-v1:sha256:72f8d7d67a253e4d40e858add1322f6df26964732e785a8ce0e2d3c0c597ed0a
    plan-execution R27.5.2: sec-v1:sha256:560a53b2f020e30bb892a3b85af257f7df553c955f10ef01139d8300be99ccdb
    plan-execution R27.6: sec-v1:sha256:c2519e0b501aa3182a71eea5440dd4d092f29e409c34df274fcd704996569b51
    plan-execution R31: sec-v1:sha256:07283bbef0618052d7e6cd60e6897bb733491dc49cbf7aabe08939fe8e768fce
    plan-execution §2: sec-v1:sha256:f69b7d9a2cd0351e08e85905540371ec6138b213a756ff884946dcb50ce78358
    plan-execution §3: sec-v1:sha256:6eeb56b26fda91768ef4936acc042f652ec5457b1d2c457c3f3472ffa3f3e992
    requests R52: sec-v1:sha256:4be72ae24a0b5e7c5b2eefb5802cfce58bb3673eef335e1e8496d43183631388
    requests R52.3: sec-v1:sha256:3b0fe08c05d7cfdee3398ebcccaef6dce82d3684e4ffea286b5598eacad422d6
    requests R52.4: sec-v1:sha256:4344eca45bcf763953a988bb56e620a8fe3be41e9a484357c3a47c9533bcedac
    specifications R67: sec-v1:sha256:3df1a2eeb88dda3e7efb18e4ba639828eb1d8cc2dfa1a10713335b6bb3abae17
    verification R36.1: sec-v1:sha256:491627824855531136a03163f4ddd236da59d32e9e6baaab7470b61d1cdde3f2
    verification R61.2: sec-v1:sha256:27e67ba5be018e74813f35f04b81f053af95e30d7e02731ef65ff4cf329e229d
    verification R61.3: sec-v1:sha256:76f9949f019b1f32264087bf7c894fc1b500fbb388104a2f55492fcc1ffc4a2d
    later-releases R37: sec-v1:sha256:a56a6805e16e75b483b3459d08775ee9b700b0a479a8daa05075a6a014facc23
    later-releases R66: sec-v1:sha256:4823baaaf41764de05ddbc443f4ab56a802c6dd7471ce716ade405dcdbdad17d
    specifications R4: sec-v1:sha256:cd3d9f4708e83188bb585d825b4e678ddbeb0f889bbd892a17bfcf712ad93eb3
    specifications R65: sec-v1:sha256:d62687005561171f9fa170d8e5a9505e8ec81875f07a1c9d7bc8ac3de001c9bf
    plans §3.2: sec-v1:sha256:35a5be1ccaa2bb2976a9b00d2e4698a8abcf4f4e606322b65bbab21c7b5b4e72
    later-releases R37.1: sec-v1:sha256:0508b51774b201c58acd6597b54574c1549590b4ea1e02bf0d3a08854eb7861e
    plan-execution R27.1.1: sec-v1:sha256:13489c336a14e5be31322cc29cfa493a44aa17ac6cdba26e5d2b4ec4b05dff9a
    plan-execution R27.2.1: sec-v1:sha256:c6ed5b38108aa0c124c887dc4246e2a50cd0c7c8ba76bb27eed8f462300d68d5
    plan-execution R31.2: sec-v1:sha256:451758ee1a6bb0b41cc11814fddf4f249bf56481d6e0806cf8af467e011e3257
    requests R52.1: sec-v1:sha256:9104fb9e5d8088271f29b3e485b2600826be78ab86a925a460c1005497b13037
    requests R52.2: sec-v1:sha256:130969d5e26b2d02492d3545aa7c3156e34944a3201ac5f63b81215ecb275fd5
    steering §2: sec-v1:sha256:19a339591de6569c8887d44678e4e0a9db15735c2a52fb6f56742a18fb79539d
    roles-and-permissions R57: sec-v1:sha256:1b06f3e6eaf07d7054ecb2cfcd8fb151df181db7d98bba461eae8802dd944f38
    cli R16: sec-v1:sha256:e984fad0ad0442293f6719a52445d2f03ea7cb11c08602d0eebbe488136d1b11
    cli R16.1: sec-v1:sha256:fdd3ac98e616905ca32c6f8b4c20d177b70061d502e950e4dd4cc52e05a7b8a7
    specifications R10: sec-v1:sha256:da377d2da649662a194aadf3214d2b0284eb19ee156cfe48a3cd3490102d782c
    specifications R11.3: sec-v1:sha256:39fae3fa736f7ec0cae702e7a5346d7ef7745af96bcc82fd9144c1eb54074978
    plans R28: sec-v1:sha256:d13d74927c488cfcd13db72c4379a0c833e16e4056d4314999028d2e568963bd
    plans R28.1: sec-v1:sha256:545fdc2be424cb44d4ba50dbab485cab48b99e76d4686511aad9e3d4d6fd2f7a
    plans R30.1: sec-v1:sha256:bab23c05d6b5e387cc4153ee7f2bd54d6976954aa403cb27eb5ecdb1dcdf33b1
    plans R69: sec-v1:sha256:90bb27053611451bcf22a7528207d5fffe3d675fb0e9f38c6cbd6edada53b1a6
    verification R12: sec-v1:sha256:484b62a0426573bb939604d0c9fc46e062bca21f980e03c62def28f142db4132
    verification R24: sec-v1:sha256:b781c9bbf26459b34aac48960bf958581e8db4c2f3acab7d006208672031922f
    verification R36: sec-v1:sha256:15268f5b20887973df8e451b41ae6a0c7834f59b531a49a5e0c8784bffb100e5
    verification R36.2: sec-v1:sha256:610bbee4e80ee213a834ed7a50e9acf40047d9bf41477e7588198576e5df34b5
    verification R61.1: sec-v1:sha256:743ffdc6f75452d7e76dceb994868cdfa983a388a0143a68167ae97b060d3a27
    verification R64: sec-v1:sha256:91a6b1828ee416b379dc02c2c97c18c6364b1256690ea4c6d3c89e950b1b4a2e
    configuration R54: sec-v1:sha256:de01b1ec06cae60b4f88c96ba9fff622fef7fa98fa28f15a14d18c5b795eb8e0
    architecture/reference-cli §5.3: sec-v1:sha256:6cf5b9caac3b3da0ee703a0628f94db87ee073f5c93c690a762f82602456fc6c
    architecture/reference-cli §7.3: sec-v1:sha256:d0e71de4658ae9a65d2e2e3fb21ec43f526bb3c80ed84c915f77138b3f6d4d3c
    architecture/reference-cli §8: sec-v1:sha256:4768bae46287eef6d7f03c4a9ce7ab198a92a371be1f2f513ac2be1abbcb7cd3
    architecture/reference-cli §11.3: sec-v1:sha256:8022ab8aca49a2eeb1b872f693197d357c44a4be3056c37d6a6568a4d1d1a615
    architecture/reference-cli §11.5: sec-v1:sha256:5d965de90f0afdc460084dd3df88fdb3873022c59325774a729f6f2cbb63e3f4
    architecture/reference-cli §11.6: sec-v1:sha256:39747fca5e6c3a2f7a83eae35e98469328f56fa0a15be987ad04717914c0e2c1
    architecture/reference-cli §11.7: sec-v1:sha256:8556cf51d94f60ca8116eb388c7c04fccabb0dc9f8cb86cecc22c55fa89cc0d1
    architecture/reference-cli §12.1: sec-v1:sha256:b044c19a1140cf798af991e8c33c5a9c19a068258de599e31789dbe3a8cbc912
    architecture/reference-cli §12.2: sec-v1:sha256:f24c6f24c85a1805fdf8fc408d864f6e6964ffe68f21437c7332955309a00943
    architecture/reference-cli §12.3: sec-v1:sha256:39afdfc14f4c1cd8862de4bfa24e2ff4c09bca141a0ea80a6613352f06dc72e3
    architecture/reference-cli §12.4: sec-v1:sha256:b2b3a4e037ce656a52b36bf489dafab9a3ec91cc321efa5d5b2bd23a2fdce1cf
    architecture/reference-cli §12.5: sec-v1:sha256:d685fd4430ffe9b00859898b0c6492840233cf8162b92e0127b9b249336610c4
    architecture/reference-cli §12.6: sec-v1:sha256:b1838d381dedb25c7382d8dbd2c169b7efd4672e5fd733faa538a9eedd116a3d
    architecture/reference-cli §12.7: sec-v1:sha256:49609d64b6aed46160d285746cd197007b4c83a3a6fe52358f132f580635659a
    architecture/file-formats §5.5: sec-v1:sha256:ac99e922ad883c71b7065b4a748bdf8260d762e8f74d0005b40aa2abba671d77
    architecture/file-formats §5.6: sec-v1:sha256:86423bbc26d5f7e71d2f922634a6184a7daac9fa1073ba54085db64a23712cec
    architecture/file-formats §6: sec-v1:sha256:cbc88aed84ec3893fcedcb07e2e6c7e407be30813b03d06203748e64f17c860b
    architecture/file-formats §8: sec-v1:sha256:d8d0449317d55d4f8e17b5713724484b53dfc15fd9ee22cc60ee60c066638288
    architecture/repository-layout §3: sec-v1:sha256:07aa7d37c8bb828d9a3ecd3966c22e2ac4b67b62ff0f8e44e8dcc81c18382b8e
    architecture/repository-layout §5: sec-v1:sha256:ca976eb0ae0164a4df6cb6bb0daa8b5d1574f63a96764b5debcf13142788f916
    architecture/reference-cli §11.2: sec-v1:sha256:a0e56e2681516e6ac3b4e355b2ee88ea9dd4ff15f635d44702b41e42266dc1a1
    architecture/reference-cli §12: sec-v1:sha256:bcaa433f15453f23278e6f190cfa8fb7aec583a12e5dfa320a962fdeb4bfc042
    architecture/file-formats §6.1: sec-v1:sha256:b7a8db327e72d6ee8c8cb5b82099422e096c1a8f7fd01acb09a7e1ab86bd68e5
    architecture/file-formats: spec-v3:sha256:1305925260c4b6989455012c2ad9c2f654a922141eaa07c4a8fcf89cb56be40d
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [harness R14, harness R18, harness R19, harness R19.1, harness R19.2, harness R20, harness R20.1, harness R26, harness R26.1, harness R26.2, harness R34, harness R35, harness R35.1, harness R47, harness §2, harness §3, harness R21, harness R38, steering R22, steering R23, steering R51, steering R59, steering R59.1, plan-execution R27, plan-execution R27.1, plan-execution R27.2, plan-execution R27.3, plan-execution R27.4, plan-execution R27.5, plan-execution R27.5.1, plan-execution R27.5.2, plan-execution R27.6, plan-execution R31, plan-execution §2, plan-execution §3, requests R52, requests R52.3, requests R52.4, specifications R67, verification R36.1, verification R61.2, verification R61.3, later-releases R37, later-releases R66, specifications R4, specifications R65, plans §3.2, later-releases R37.1]
references: [plan-execution R27.1.1, plan-execution R27.2.1, plan-execution R31.2, requests R52.1, requests R52.2, steering §2, roles-and-permissions R57, cli R16, cli R16.1, specifications R10, specifications R11.3, plans R28, plans R28.1, plans R30.1, plans R69, verification R12, verification R24, verification R36, verification R36.2, verification R61.1, verification R64, configuration R54, architecture/reference-cli §5.3, architecture/reference-cli §7.3, architecture/reference-cli §8, architecture/reference-cli §11.3, architecture/reference-cli §11.5, architecture/reference-cli §11.6, architecture/reference-cli §11.7, architecture/reference-cli §12.1, architecture/reference-cli §12.2, architecture/reference-cli §12.3, architecture/reference-cli §12.4, architecture/reference-cli §12.5, architecture/reference-cli §12.6, architecture/reference-cli §12.7, architecture/file-formats §5.5, architecture/file-formats §5.6, architecture/file-formats §6, architecture/file-formats §8, architecture/repository-layout §3, architecture/repository-layout §5, architecture/reference-cli §11.2, architecture/reference-cli §12, architecture/file-formats §6.1, architecture/file-formats]
---

# Agent skills

This spec says how Specplane's harness-neutral command contracts work: what a contract contains, what the standing instructions say, how command instructions and steering are assembled and delivered, how the LLM retrieves specification context, and the contract of each harness command. A contract says what the LLM and the harness do; it never repeats a mechanical operation, which the CLI core performs and the harness reaches through actions (`architecture/reference-cli §12.1`). The modules that deliver these texts are in `architecture/reference-cli §12`; where installed files live is `architecture/repository-layout §5`; file contents are in `architecture/file-formats`. Each section states which feature sections it implements. Details the feature specs leave open are marked "assumption". Later-release items are marked "later release".

## §1 Contract structure

Implements `harness R34`, `harness R35`, `harness R35.1`, `harness R18`.

A **command contract** is one markdown template per command, shared by every harness (assumption: `assets/commands/<command>.md` in the package). Core steering and docs (`§4`, `§7`) are filled into it; a harness adapter packages the result in its own format (a skill folder, a prompt file, a hook payload) and adds only invocation detail, never behaviour (`harness R34`). Every contract has these parts in this order:

1. **Purpose.** One paragraph: what the command does for the user and which feature sections it carries out.
2. **Preconditions.** What must hold before anything happens: configuration present, permissions held (mode named per action), spec or plan state. A failed precondition ends the command with the reason and no change.
3. **Steps.** Numbered, each marked `[code]` (done by an action, mechanical, no model) or `[llm]` (needs reasoning or writing). A `[code]` step is a named action of `architecture/reference-cli §12.1`; the LLM never reconstructs one by hand (`harness R47`).
4. **Permissions and requests.** For each action the permission it uses and what happens under allow, request user and deny (`§5`).
5. **Output.** What the LLM tells the user at the end, in a few sentences.

Rules every contract follows:

- **Config first.** The first step of every contract except documentation lookup reads `.specplane/config.yaml` through `config.get` and resolves every path from it (`architecture/file-formats §6`); it never assumes one. In a project without configuration the contract does nothing and says Specplane is not set up (`harness §2`).
- **Typed command versus words.** A command typed with no arguments runs its `[code]` steps only and starts no model turn; with arguments it passes them with the contract to the LLM (`harness R18`). Asking the LLM in plain words runs the same contract under the LLM's role and the same checks (`harness R18`).
- **Capability check.** A contract names the capabilities it needs (`instructions-on-demand`, `subagents`, `usage-measurement`, `viewing`). An adapter that lacks one refuses the command and says which, and does not substitute a weaker path such as asking the user to run the CLI (`harness R35.1`).
- **No approval.** No contract sets a spec or plan to `approved`, or a plan to `completed` or `abandoned`, by editing a file; only the approval, finish and abandon actions do, under the role (`harness R20`).

## §2 Standing instructions

Implements `harness §2`, `harness §3`, `steering R59`.

The standing instructions are a fixed short text, the same for every harness and role. They say: Specplane is in use; read `.specplane/config.yaml` before acting on specs or plans and resolve paths from it; the LLM has a role and must look up its steering before acting (`steering R59`); do not call the Specplane CLI, use the harness actions; commits made in a Specplane workflow carry the workflow, plan, step and session trailers when set (`architecture/file-formats §8`). They contain no steering, rules or procedures, no permission modes and no secrets: those arrive with the command (`§3`). The text carries the Specplane version and the steering stamp (`§4`).

Delivery (assumption on form): an owned file in the harness's own directory when it has one, otherwise one marked block in a shared instruction file, added once and changed only between its markers (`architecture/repository-layout §5`, `architecture/reference-cli §12.6`). A project may forbid the block with `harness.install_block: off` (`architecture/file-formats §6.1`); its own instruction files are then never touched. Two harnesses share one block (`harness §3`). The block says edits inside it are overwritten. A missing or older delivery is a warning (`verification R24`).

## §3 Instruction assembly and delivery

Implements `harness R14`, `steering R22`, `steering R23`, `specifications R4`.

Each command and each permission has an **instruction text**. A text is assembled when needed, in this order:

1. The command's contract (`§1`), or for a permission its limit text (`§4`).
2. The command's documentation, which is the default instruction (`steering R22`); `harness.instructions.<command>` replaces the documentation part only (`architecture/file-formats §6`). The contract's `[code]` steps and the checks of `architecture/reference-cli §7.3` stay whatever the replacement says (`harness R14`).
3. Steering for the command and the permissions it uses (`§4`).
4. The optional separation check when the command writes specs and `harness.separation_check` is on: the LLM verifies that feature and architecture content is separated and warns per change (`specifications R4`, `harness R14`).

**When it is sent.** Via `deliver(session, key)` (`architecture/reference-cli §12.3`): on the first use of a command in a session, never twice in one compaction epoch, again after a reported compaction, and always again when the adapter cannot report its context. A harness that loads instructions on demand gets a pointer to the packaged contract instead of the text, with the same effect (`harness R14`). If the adapter cannot deliver at the command, it delivers at session start and prints a notice that it did (`harness R35.1`).

**AI-facing documentation.** `build-ai-docs` derives it from the user documentation, so the two cannot disagree (`steering R23`). The always-loaded part is the orientation, the role and limits, and the steering of commands in use, under a size limit tested in the build. Everything else is searched through `docs.search`. The standing instructions and each contract tell the LLM that more documentation exists and to search it, not guess, when it lacks information (`steering R23`).

## §4 Steering assembly

Implements `steering R59`, `steering R59.1`, `steering R51`, `specifications R65`.

Steering is generated, never written by the model (`architecture/reference-cli §12.4`). Inputs: the acting role, the mode of each permission under the active preset, the command list, and the templates in `assets/steering/`. Outputs, three layers:

- **Role steering** (short, in the standing delivery of `§2`): the role, what it may do in a line each, that Specplane's checks and not steering decide, that a denial is final, no bypass by another tool, rephrased action, another role, side route or direct file edit, no CLI, keep credentials out of summaries (`steering R59`, `verification R61.3`).
- **Permission steering** (sent with the command that uses the permission): the limit in the role's mode, and the no-bypass statement (`steering R51`). The same text is the permission's documentation (`configuration R54`) and the body of a refusal reply naming the permission.
- **Case steering**, attached to commands: the five cases (below), blocking choice, spec-change check, contradiction rule.

The five cases a contract relies on, with their wording fixed in the templates:

| Mode or situation | The LLM is told to |
|---|---|
| `request-user` | send a request naming the one action, do not do it first |
| `deny` | not do it, not look for another way, tell the user, leave the move to them |
| user-run command (approval) | ask the user to run it and say what it will do |
| `allow` | act directly unless custom steering says otherwise; steering does not guarantee the LLM asks first |
| blocked in a plan run | continue unblocked work with a non-blocking request, else soft stop (`§5.3`) |

Further case texts: if a plan points at an older commit of a referenced spec than the latest, check what changed first (`plan-execution R27`, `plans R28.1`); a spec the LLM writes starts awaiting-review and cannot be approved by the LLM without the permission and the user's decision (`roles-and-permissions R57`); specs at different layers that contradict: follow the higher layer and report it (`specifications R65`); specs at the same layer that contradict: report and do not implement the contradicted behaviour (assumption beyond the page, as `steering R59` marks it); work one plan step at a time and record gaps in the plan record (`plans R28`).

**Custom steering** comes from `steering.custom` items `{permission|command, scope, text}` (`architecture/file-formats §6`). It is appended after the generated text of the same permission or command, general before specific and each labelled, with the line "on conflict the more specific wins"; it never replaces role or permission steering and cannot widen or narrow a permission (`steering R59.1`). The complete text an LLM receives for a command or permission is shown by `specplane steering` (`steering R59.1`).

**Stamp and staleness.** Generated text and delivered files carry the stamp of `architecture/reference-cli §12.4`. When roles, presets or custom steering change, the steering and installed files are regenerated; if regeneration fails, delivery is replaced by a notice that the text cannot be trusted and a warning is raised (`steering R59`, `steering §2`). Steering and permission disagreeing is reported, and the permission wins (`steering §2`).

**Test (assumption, deterministic).** For every permission kind in the default presets the generated permission steering is non-empty and contains the no-bypass statement (`steering R51`).

## §5 Permissions, requests and soft stop in contracts

Implements `requests R52`, `requests R52.3`, `requests R52.4`, `plan-execution R27.3`, `plan-execution R27.5`, `plan-execution R27.5.1`, `plan-execution R27.5.2`, `plan-execution R27.1`, `steering R59`.

### §5.1 Every action is checked

Each `[code]` step is an action whose handler calls the guard (`architecture/reference-cli §7.3`). The contract does not decide the outcome; it handles each reply:

- **Done.** Continue.
- **Request sent** (mode `request-user`). The reply says a request was stored and nothing was done. The LLM tells the user what it asked for and does not retry the action, do part of it, or go round it (`requests R52`, `requests R52.3`). In a plan run it goes to `§5.3`.
- **Refused** (mode `deny`). The reply names the permission. The LLM tells the user, and does not propose an alternative with the same effect. No request exists for a denied action (`requests R52.3`).
- **Allowed but steered to ask.** If custom steering says to send a request or ask the user first, the LLM calls `request.send` with the permission the action would need (`architecture/reference-cli §8`) and waits for the user.

The LLM has no action that accepts or declines a request, or that switches role (`architecture/reference-cli §12.1`). The request pane and dialogue belong to the user (`requests R52.1`, `requests R52.4`).

### §5.2 Requests outside a plan

A request is sent and the contract ends with an output line saying a request is pending and how to answer it in the pane. The LLM does not wait in the session (`requests R52`).

### §5.3 Requests and blocks inside a plan run

- **Blocking.** The LLM sets `blocking: true` when the next work depends on the action or building on a refused change would be waste; it prefers blocking when unsure (`steering R59`). The action soft-stops the plan with reason `waiting for request <id>`; the contract then writes the handoff entry and ends the run (`plan-execution R27.5.1`, `architecture/reference-cli §11.3`).
- **Non-blocking.** The LLM sends the request, records it in the step's handoff "Open issues" section (`architecture/file-formats §5.5`) and continues with work that does not depend on the answer without doing what was requested (`plan-execution R27.5.2`).
- **Block that is not a request** (a forbidden tool, a missing file): if other steps do not depend on it the LLM sends a non-blocking request and continues; if nothing useful remains, or the block affects the whole plan, it calls `plan.softstop` with a reason and what must change. A block is never turned into a skipped step (`plan-execution R27.3`).
- **Budget soft stop.** When the adapter reports a soft stop, the contract tells the LLM to reach a safe point, commit, write the partial handoff entry and call `plan.softstop`; the adapter ends the session by force at the hard stop (`plan-execution R27.1`, `architecture/reference-cli §11.3`).
- **No waiting.** A run never waits open for an answer; waiting is a stopped plan (`plan-execution R27.5`).

## §6 Context retrieval

Implements `harness R26`, `harness R26.1`, `harness R26.2`, `harness R21`, `harness R38`.

- **Action.** `spec.retrieve` takes one or several spec IDs and `include_references` (default `harness.retrieval_include_references`). The reply names each spec, then each cited section with its source cite, the section and its subsections only, deduplicated; an unresolved cite is returned as `not found`; effectively awaiting-review specs and parts are marked; text comes from the working tree and status from HEAD, with a note when they differ (`architecture/reference-cli §12.5`).
- **Use by contracts.** Every contract that touches a spec starts with one `spec.retrieve` per working set instead of reading referenced files, and reads a file directly only for a part retrieval did not return. `plan-step` retrieves the step's `context` cites; `spec-assist` and `spec-draft-architecture` retrieve the spec and the cited higher-layer parts (`§7`).
- **Permission.** `info.retrieve`, mode allow by default; a role with deny is told so and the contract stops (`harness R26.2`). Retrieval does not depend on the permission to edit, so a role that cannot write a spec still reads it.
- **Other reads.** `spec.review-context` returns a spec with its coverage, warnings and recorded results for review; `warnings`, `coverage` and `audit.read` are read-only actions under the same permission (`architecture/reference-cli §12.1`).
- **Later release.** Viewing (`harness R21`) and spec review (`harness R38`) are contracts that use `spec.retrieve` and `spec.review-context`. Review is read-only: feedback goes to the user in conversation, and a change that follows is a separate edit under `harness R19.2`. When decision records are on the LLM may store the user's decision (`§7.11`). They use the same permission and have none of their own (`harness R26.2`).

## §7 Command contracts

Implements `harness R19`, `harness R19.1`, `harness R19.2`, `harness R20`, `harness R20.1`, `plan-execution R31`, `plan-execution R27`, `plan-execution R27.2`, `plan-execution R27.4`, `plan-execution R27.6`, `plan-execution §2`, `plan-execution §3`, `plans §3.2`, `specifications R67`, `verification R36.1`, `verification R61.2`, `verification R61.3`, `later-releases R37`, `later-releases R37.1`, `later-releases R66`. Command names are those installed for Claude Code (`harness R18`); another harness may spell them differently but keeps the contract. A command marked "user only" is run by the person and is never offered to the LLM.

### §7.1 spec-assist

Purpose: write or edit a feature or architecture spec with the user (`harness R19`). Preconditions: config read; `spec.create.<type>` or `spec.edit.<type>` for the spec's type is not `deny` (`harness R19.2`).

1. `[code]` `config.get`; `spec.retrieve` of the spec being changed (if any) with its cited parts, and of related specs the user names.
2. `[llm]` Discuss and refine the content with the user until they finalise it. Apply the separation check (`§3`). Do not invent requirements; ask.
3. `[code]` `spec.create` (new spec, ID from the path, cites in `covers` or `implements`) or `spec.edit` (section or whole file). Under request-user the edit becomes a request holding a patch and nothing is written; the LLM stops at `§5.1` (`harness R19.2`).
4. `[code]` The action appends the LLM as author with a contribution at the granularity of the change when `authorship.record_llm` is on, using the model the adapter reports (`harness R19.1`, `specifications R10`). It rejects any `approved` status or `approval` block in supplied text (`architecture/reference-cli §12.1`).
5. `[code]` `validate` scoped to the spec; report its findings.

Output: what changed, that the spec is awaiting-review, and that approval is a separate step for the user (`specifications R11.3`, `harness R20`).

### §7.2 spec-draft-architecture

Purpose: generate an architecture spec from feature specs, or a feature spec from requirements (`specifications R67`). Preconditions: the source specs exist; the create permission is not `deny`; the sources need not be approved, and the output says when they are not.

1. `[code]` `spec.retrieve` of the sources with referenced parts.
2. `[llm]` Draft the spec: topics, not feature sections; each section cites the source parts it implements in its frontmatter and states them in the body; unclear or contradictory source parts are listed as questions for the user, not decided; detail the sources leave open is marked "assumption".
3. `[code]` `spec.create` as in `§7.1` step 3 to 5.
4. `[llm]` Report coverage of the sources: `coverage` shows source parts nothing covers (`verification R64`).

Output: the new spec, its source cites, uncovered source parts, open questions. The draft is awaiting-review with the LLM as author; it may be a plan step (`plans R30.1`).

### §7.3 plan-create

Purpose: create a plan, optionally (`plans R69`). Preconditions: `plan.create` not `deny`.

1. `[code]` `config.get`; `spec.retrieve` of the specs the user names and those they cite.
2. `[llm]` Propose goal, acceptance criteria, ordered steps (small enough for one session, `plans §3.2`), the specs each step implements, referenced plans and context cites. Show the proposal to the user as text and adjust.
3. `[code]` `plan.create` writes the folder from the template: ID from today's date and two to four words, `status: awaiting-review`, empty progress `not-started`, step files (`architecture/reference-cli §11.5`).
4. `[code]` `validate` scoped to the plan.

Output: plan ID and path, steps, that nothing runs and that the plan is approved like a spec (`plan-execution R31`). `plan.edit` is the same flow for later changes, refused for a step that has started (`architecture/reference-cli §11.5`).

### §7.4 plan-start

Purpose: start a plan in its own worktree and branch (`plan-execution R27`, `plan-execution R27.6`). Preconditions: `plan.start` not `deny`; the plan and the specs it implements and references approved when `plans.start_conditions` is on. Wholly `[code]`:

1. `plan.start` with the target (user's, else current branch) and any named dependencies to force, which the handoff records (`architecture/reference-cli §11.3`).
2. On refusal print each unapproved plan or spec, or the missing permission.

Output: the plan ID, branch `plan/<id>`, the worktree path (`architecture/repository-layout §3`), and the exact command that opens a session there (or, with `session opening`, that the session was opened, assumption). The project directory stays on its branch.

### §7.5 plan-step

Purpose: do the next step, or several, of one plan, in its checkout (`plan-execution R27`, `plan-execution R27.4`). Preconditions: the session is in the plan's worktree on `plan/<id>`, else the command names the checkout and stops (assumption beyond `plan-execution R27`, which has the harness start the session: in the first release the user opens it, using the command `plan-start` prints, and an adapter with the capability `session opening` opens it itself); `plan.next` reports a ready step (a waiting step names the unapproved spec it needs and the run stops with a soft stop, `plans R30.1`); the selection starts at the next step.

1. `[code]` `plan.next` for the selection; a selection starting later is denied naming the step that comes first. If the plan is `stopped`, resume first (`§7.9`).
2. `[code]` `spec.retrieve` of the step's `context` cites and `implements` specs, and the earlier handoff entries. If a referenced spec changed since the plan's recorded commit, the LLM checks what changed before going on (`§4`).
3. `[llm]` Implement the tasks, one step only, never needing the user: a gap or assumption goes to `spec-gaps.md` as a new entry (`architecture/file-formats §5.6`), a needed spec change goes through `spec.edit` under its permission, a missing thing becomes a request or soft stop (`§5.3`). Precedence: architecture over feature; contradictions across layers follow the higher layer and are reported, same-layer contradictions stop the step (`steering R59`).
4. `[code]` Declared tests of the step run with `test.run`, results with `test.record` (`§7.8`).
5. `[llm]` Write the handoff entry sections (`architecture/file-formats §5.5`), with the outcome `done` or `partial`.
6. `[code]` `plan.step-done` with the outcome: requires the handoff entry and a commit since the step began, makes an entry-only commit if there is none, advances progress and commits it (`architecture/reference-cli §11.3`, `architecture/file-formats §8`). A stopped partial step commits partial work and entry (`plan-execution R27.4`). Where a harness records the step itself, the LLM does not call this action.
7. `[code]` If more steps are selected, repeat from 1; stop on a soft stop or a blocking request.

Output: outcome, files changed, gaps by ID, open issues, requests sent, next step. After the last step the contract opens the final review through `§7.6` rather than completing the plan (`plan-execution §2`).

### §7.6 plan-finish

Purpose: the final review and decision (`plan-execution §2`, `plans R28`, `plans R28.1`). Preconditions: `plan.review` is read-only and always allowed; the decision needs `plan.complete`.

1. `[code]` `plan.review`: per-step outcomes, open gaps, unrun steps, pending requests of the plan, referenced specs changed on the target since the start, plan-branch spec changes (`architecture/reference-cli §11.6`).
2. `[llm]` For each acceptance criterion state met or not met with the evidence. Do not decide.
3. Show the user the review. The decision is the user's: `plan.finish` with `--complete` or `--back <reason>` under `plan.complete`. With request-user the decision is a request; with deny the LLM stops after the review (`§5.1`).
4. `[code]` On complete: archive the plan in the plan branch's last commit. On back: set in-progress with the reason; the LLM proposes added or changed steps through `plan.edit`.
5. Merging is separate: the LLM offers the `plan.merge` action (guarded by `plan.complete`) as a pull request or local merge, and never resolves conflicts; they are shown to the user (`plan-execution §2`, `architecture/reference-cli §11.6`). If the target moved since the review began, the review is shown again first.

Output: the review, the decision or the pending request, and the merge options.

### §7.7 plan-status

Wholly `[code]`, no model turn when typed without arguments. `plan.list` with live status reads each running plan's checkout; a run marker with no live session is shown as stopped, "session ended unexpectedly" (`architecture/reference-cli §11.2`). Output: each plan with status, stop reason, next step and what is waiting (a spec to approve, a request to answer).

### §7.8 validate and verify

**validate** (`verification R12`): `[code]` `validate`, then `warnings` and `coverage`; `[llm]` summarise findings by severity and name the fix for each; the LLM never edits to silence a finding without the user's say. Without arguments the harness prints the CLI output and starts no model turn.

**verify** (assumption: command name `verify`; implements `verification R36.1`): judges an architecture spec against its implementation.

1. `[code]` `spec.review-context` for the spec; the declared tests and which sections declare none.
2. `[code]` `test.run` for each declared test; run on committed state with a note when the tree is dirty (`verification R36.2`).
3. `[llm]` For each section declaring none, or declaring intelligent judgement, read the section and the implementation and decide met or not, with reasons of a few lines, keeping credentials and private data out of the summary (`verification R61.3`, `steering R59`).
4. `[code]` `test.record` for each result: allow records; request-user records after the user accepts, and records nothing if the commit or content changed meanwhile; deny shows the outcome as not recorded (`verification R61.2`). Result belongs to the checked spec (`verification R61.1`).
5. `[code]` When all pass and the permission and `architecture.llm_may_mark_implemented` allow, `spec.implement` (`verification R36`); a failed result refuses it, naming the test.

Output: per-section result, what was recorded, and the implemented status.

### §7.9 approve and request handling

**approve** (user only, no model, `cli R16`, `harness R20`): the user runs it with one or more IDs; the adapter runs the user-command runner as `standard-user` (`architecture/reference-cli §12.2`) which applies the checks of `architecture/reference-cli §5.3`, including group approval with the listed warning and confirmation. The command never interprets words. When the user asks the LLM in words to approve, the LLM identifies the spec, then calls `spec.approve` under its own permission: allow approves, request-user sends a request, deny refuses (`harness R20`, `harness R20.1`, `cli R16.1`). The contract states that a role with allow approves without further question and that steering does not guarantee the LLM asks first (`harness R20.1`). The LLM never accepts a request and never approves by editing a file (`§1`).

**requests** (user only): opens the pane (`requests R52.1`, `requests R52.2`); no model. **plan resume** and **plan budget** are `[code]` actions: `plan.resume` returns the resume context (next step, handoff, answered requests; the earlier session log only after a hard stop or unexpected end, `plan-execution R27.2`) and the contract continues with `§7.5`; `plan.budget` sets `{resource, soft, hard}` and refuses an unmeasurable resource (`plan-execution R27.1`, `plan-execution R27.1.1`, `plan-execution R27.2.1`).

### §7.10 plan-abandon

Purpose: end a plan that will not be done (`plan-execution §3`). Preconditions: `plan.abandon` not `deny`. Steps: `[code]` show the plan, its run state and the worktree status, and ask the user to confirm; `plan.abandon` stops the run, archives the plan as abandoned and removes the worktree unless it has uncommitted changes, when the user chooses to force or leave it; the branch is kept (`architecture/reference-cli §11.7`). Output: the result, the kept branch, and plans that reference it and can no longer start. `plan.delete` follows the same flow under `plan.delete`.

### §7.11 Later release

- **decision-new** (`later-releases R37`, only when `decisions.enabled`): the LLM writes a decision record only after the user has made the decision in conversation, recording the decision, context, reasons, date and the spec or plan it concerns; it retrieves matching records before a related choice and says when one applies. Permissions are in `later-releases R37.1`. With decisions off nothing is stored or searched.
- **migrate** (`later-releases R66`): the prompt is a configurable instruction (`harness R14`). Preconditions: create permission is not `deny`, else the LLM requests or tells the user what to create. Steps: `[llm]` read existing specs, documents and code and show what was found and what it proposes; `[code]` `spec.create` for each, all awaiting-review whatever the old status; old files untouched. Output lists migrated, left and uncertain items.
- **parallelism** (`plan-execution R31.2`, assumption): steps that list independent tasks use subagents up to the configured number; without subagents tasks run one after another and the user is told.

## §8 Keeping the LLM off the CLI

Implements `harness R47`.

Contracts name only harness actions, never `specplane` commands, and the standing instructions say not to call the CLI (`§2`). Enforcement is the adapter's shell hook (`architecture/reference-cli §12.7`); a harness without one says so at setup (`harness R35.1`). When an action is missing for something the LLM needs, the contract tells the user to run the human command, and that is a gap to fix, not a pattern.

## §9 Keeping contracts in step with specs

Implements `harness R34`, `harness R35.1`.

- Every contract is a package asset and carries a version header; the installed copy is compared with the CLI's by validation, and an older or missing copy is a warning (`architecture/reference-cli §12.6`).
- A change to a contract that alters preconditions, order of steps or permissions is a change to this spec first; the templates are then regenerated, and the harness copies are rewritten by setup. Contracts and steering are never hand-edited in a project.
- Harness specifications may add invocation detail and must cite the contract section they package; they must not remove or reorder a step (`harness R34`).
- The user documentation lists, for each harness, which commands and capabilities it supports (`steering R22`, `harness R35.1`).
