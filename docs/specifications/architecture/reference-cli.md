---
id: architecture/reference-cli
title: Reference CLI
status: approved
approval:
  by:
    llm: claude-sonnet-5-5
    delegated-by: spiralsky
  date: 2026-11-09
  commit: 380a893a01aba93dd6694e9a0aab9e67cef0615f
  note: approved by the LLM, not a human, under the user's 2026-11-09 delegation (hand-edited because the CLI cannot read this format; see docs/work-records/2026-11-09-spec-format.md)
  fingerprint: spec-v3:sha256:6e1ef7c401ba94f9cea19d6a44cf55bac88917fe801fd46325bb7e2b4f900c55
  cited:
    cli R16: sec-v1:sha256:e984fad0ad0442293f6719a52445d2f03ea7cb11c08602d0eebbe488136d1b11
    harness R34: sec-v1:sha256:c99f8eb6bee676df8f3cda14e355d27fbf8d41396e0b8af6b02acb12656f5ef3
    configuration R25: sec-v1:sha256:e07f837db35bfe39bbd28e56e36f3bbb1d0afc25bc3b8784f90a92be6d49b071
    configuration R25.1: sec-v1:sha256:63db974347ae4f64926a4d697c3083844b86e14b46ef54ef53a16c4af19d20fa
    plan-execution R27: sec-v1:sha256:16be697fca95202f6580e27147551a2774b7edabed2ca7abceb3656e707507db
    specifications R1: sec-v1:sha256:e14e28290c7a996d6b4858b6fe7ed9206c48e45750806da7ed117c2068980161
    specifications R5: sec-v1:sha256:88bdf67dbb7f5a04efaa64f11c63486a285c1a184090f0fe3ab6d2d8166eb9a2
    specifications R7: sec-v1:sha256:b97cf139a08f8de7a4af660c79a35472f627e128accb361ef4a5453ad230418e
    specifications R9: sec-v1:sha256:faa3544c96036f5eb5010877f99d4e5bd3e346628f86440922d0b919ba0203e7
    specifications R10: sec-v1:sha256:da377d2da649662a194aadf3214d2b0284eb19ee156cfe48a3cd3490102d782c
    specifications R10.1: sec-v1:sha256:bcd4914e643274025c85e5dc2f8ee8be06c8dbb8f11a8b3a27565924eac1f7e1
    specifications R11: sec-v1:sha256:57fb631a35838abb06b893d183aae50c7cd3ab7d8e322aae1b81908c1be1f94e
    specifications R11.1: sec-v1:sha256:29880970814e576e479b9aded1a2ea8c4b89a91c15a552242999690edab1bea8
    specifications R11.2: sec-v1:sha256:bf6661cea11d86931085fc47823410d8d4b79e7f240a7d0100242ed9d51cccf3
    specifications R11.3: sec-v1:sha256:39fae3fa736f7ec0cae702e7a5346d7ef7745af96bcc82fd9144c1eb54074978
    specifications R11.4: sec-v1:sha256:f91b09b062967522d18f4cfea04f777a62e11db4531e25e446388cee0d800014
    specifications R40: sec-v1:sha256:06256b91ec636327529518186fe36cf513ed6b4a33fbd4d4c259b52ff3e29f17
    cli R16.1: sec-v1:sha256:fdd3ac98e616905ca32c6f8b4c20d177b70061d502e950e4dd4cc52e05a7b8a7
    verification R12: sec-v1:sha256:484b62a0426573bb939604d0c9fc46e062bca21f980e03c62def28f142db4132
    verification R24: sec-v1:sha256:b781c9bbf26459b34aac48960bf958581e8db4c2f3acab7d006208672031922f
    verification R24.1: sec-v1:sha256:5c3cc7ef3c6108f2ad184e5de1a6806dd377715d8eee6eb39df1f95b835e8975
    verification R64: sec-v1:sha256:91a6b1828ee416b379dc02c2c97c18c6364b1256690ea4c6d3c89e950b1b4a2e
    configuration R54: sec-v1:sha256:de01b1ec06cae60b4f88c96ba9fff622fef7fa98fa28f15a14d18c5b795eb8e0
    roles-and-permissions R42: sec-v1:sha256:bf5c701b7be78ea0f002a6ae7ea6086718d25a4eea136d17d2d38eb847a3f22d
    roles-and-permissions R42.1: sec-v1:sha256:854bd6cb3c3bbeb8c3e2277447d6fe5e711fd5b5e2639ff241ee29e452fcf03f
    roles-and-permissions R42.2: sec-v1:sha256:4f72546dbbd3cb982f0007073fc34798ba31468c6401a2a1260bf5d653b08261
    roles-and-permissions R44: sec-v1:sha256:1936fdd41a426f2a4d76c443f8a2a2520b04d8ac949469f1cf9cadbdce59de01
    roles-and-permissions R46: sec-v1:sha256:98c942a43ce69694ed848b4dee10373a01509c505deed0ce7a5f07ad97d52ded
    roles-and-permissions R50: sec-v1:sha256:6e06bc008e3c498900010a6e4117f60f0626279609ce22d6b0bcb36c4c245ce2
    roles-and-permissions R55: sec-v1:sha256:f5d2bf684313f3759d3b312fc06c266ba043957215de27e4ee3784e89de38a80
    roles-and-permissions R56: sec-v1:sha256:bb5d5bfb69c08d216d818c2b0ccd916e21fa1d60b85785285302a95fdb94975e
    roles-and-permissions R56.1: sec-v1:sha256:fa48bf1ee04d60b533f3d06fefe20ffd0c46bbd6030e14caf49642a29533d198
    roles-and-permissions R57: sec-v1:sha256:1b06f3e6eaf07d7054ecb2cfcd8fb151df181db7d98bba461eae8802dd944f38
    cli R17.1: sec-v1:sha256:074ecf80e763c00f46c1f98f26fc2628736726ccca1aef0456791aeda58d6db6
    cli R17.2: sec-v1:sha256:db68716df13432cda3173ec1949ea0eec432d390cbac3f4924f6f5bf060c0749
    requests R52: sec-v1:sha256:4be72ae24a0b5e7c5b2eefb5802cfce58bb3673eef335e1e8496d43183631388
    requests R52.1: sec-v1:sha256:9104fb9e5d8088271f29b3e485b2600826be78ab86a925a460c1005497b13037
    requests R52.2: sec-v1:sha256:130969d5e26b2d02492d3545aa7c3156e34944a3201ac5f63b81215ecb275fd5
    requests R52.3: sec-v1:sha256:3b0fe08c05d7cfdee3398ebcccaef6dce82d3684e4ffea286b5598eacad422d6
    requests R52.4: sec-v1:sha256:4344eca45bcf763953a988bb56e620a8fe3be41e9a484357c3a47c9533bcedac
    requests R52.5: sec-v1:sha256:0d6bbbb722eb26313df021b8bb3ab591f8919bb063fa3b87bbdab45d03952b4a
    plan-execution R27.5: sec-v1:sha256:3a43aca88d2824049cc58660daae61614ab24c1132330cca61f1b2976b622b74
    plan-execution R27.5.1: sec-v1:sha256:72f8d7d67a253e4d40e858add1322f6df26964732e785a8ce0e2d3c0c597ed0a
    plan-execution R27.5.2: sec-v1:sha256:560a53b2f020e30bb892a3b85af257f7df553c955f10ef01139d8300be99ccdb
    verification R13: sec-v1:sha256:99caab386dc99044e2012a678aedafb986120fbe2a5250bd5bb919a773cdd240
    verification R13.1: sec-v1:sha256:1aa194ab8cf86b69f12dc75d4699b0fed89fd5f7251408093122d21e660ff3bc
    verification R36: sec-v1:sha256:15268f5b20887973df8e451b41ae6a0c7834f59b531a49a5e0c8784bffb100e5
    verification R36.1: sec-v1:sha256:491627824855531136a03163f4ddd236da59d32e9e6baaab7470b61d1cdde3f2
    verification R36.2: sec-v1:sha256:610bbee4e80ee213a834ed7a50e9acf40047d9bf41477e7588198576e5df34b5
    verification R61: sec-v1:sha256:8faf1fe8368dd68ecc9eaf7104385c4bf47d9db883e0bdcfbcf8323b9b38a87d
    verification R61.1: sec-v1:sha256:743ffdc6f75452d7e76dceb994868cdfa983a388a0143a68167ae97b060d3a27
    verification R61.2: sec-v1:sha256:27e67ba5be018e74813f35f04b81f053af95e30d7e02731ef65ff4cf329e229d
    verification R61.3: sec-v1:sha256:76f9949f019b1f32264087bf7c894fc1b500fbb388104a2f55492fcc1ffc4a2d
    verification R61.4: sec-v1:sha256:33d9f2074c2431ea4e976f9b0cb9e94a8e809280554248b86b6c7d935dc19668
    verification §2: sec-v1:sha256:5dd1ffe1d05568f7f49e67a169430b69d8f23db9dc43d4887cbaffb582e4412c
    verification §3: sec-v1:sha256:ff7ecd9663b35a60355a817e949b3be48f5c1503458c78b3974ebb714fc7ca3e
    plans R28: sec-v1:sha256:d13d74927c488cfcd13db72c4379a0c833e16e4056d4314999028d2e568963bd
    plans R28.1: sec-v1:sha256:545fdc2be424cb44d4ba50dbab485cab48b99e76d4686511aad9e3d4d6fd2f7a
    plans R29: sec-v1:sha256:3fe70a4219adab63a737d32016915ed60a5fcebed12fa497d026c1b66bb1eb7d
    plans R29.1: sec-v1:sha256:49fde14b93412ce5869a57bae1085c04a08f6ae7b2deec5a92e8517d2539ba22
    plans R29.2: sec-v1:sha256:bc3c3a58388481e6be01c429b7cc80b1a0459f4dde239072f5308f0c62c139b6
    plans R29.3: sec-v1:sha256:e07b6ad570ab8184bdc89705217718f420bbe5d8da950ec4d9e837d773780ae7
    plans R30: sec-v1:sha256:fa450a722ef3c77c82274c05e2f549f368a62a4059a32bb39a9318e5f7d70335
    plans R30.1: sec-v1:sha256:bab23c05d6b5e387cc4153ee7f2bd54d6976954aa403cb27eb5ecdb1dcdf33b1
    plans R69: sec-v1:sha256:90bb27053611451bcf22a7528207d5fffe3d675fb0e9f38c6cbd6edada53b1a6
    plans §2: sec-v1:sha256:0f815d19f4e4ccd6eaf85f3825ada70b8ec20dd6fc9c97a9134bcebe8e2d233d
    plans §2.1: sec-v1:sha256:db569dc411c857eedbbd39acdc9873aafc2a41adb75f2db78c2b6bb4cb801ef7
    plans §2.2: sec-v1:sha256:69661f6b42e365736aeda828544f7563fa164965fc4238813c72f73f46f95dfc
    plans §3.1: sec-v1:sha256:a627ace4d1900314fb34c75d6c3c8f71039305d0665a81ad6acdc710a82225f0
    plan-execution R27.1: sec-v1:sha256:eb372e0c9bc8e7d6356a33d6dfcea88ad37c6e2adec2470a2b7fa7464efc6783
    plan-execution R27.1.1: sec-v1:sha256:13489c336a14e5be31322cc29cfa493a44aa17ac6cdba26e5d2b4ec4b05dff9a
    plan-execution R27.2: sec-v1:sha256:ad9223052ac0145b15b4094fb5d03818a61a74b3eacbe4320cab3a8d60cc94b3
    plan-execution R27.2.1: sec-v1:sha256:c6ed5b38108aa0c124c887dc4246e2a50cd0c7c8ba76bb27eed8f462300d68d5
    plan-execution R27.3: sec-v1:sha256:35299fcdf7de2e8cc7d22a5adef82d653de1f42673a71f7167c1ede4f08e2c38
    plan-execution R27.4: sec-v1:sha256:3d7b10b203e5ad988fa6007ece52ab79d06327886b8fa423411b32493e3fc95c
    plan-execution R27.6: sec-v1:sha256:c2519e0b501aa3182a71eea5440dd4d092f29e409c34df274fcd704996569b51
    plan-execution R31: sec-v1:sha256:07283bbef0618052d7e6cd60e6897bb733491dc49cbf7aabe08939fe8e768fce
    plan-execution R31.1: sec-v1:sha256:bac85a98405325af2ed382a8ef7d41a7d6065a3dd5401ed330eaa852f184c4e7
    plan-execution §2: sec-v1:sha256:f69b7d9a2cd0351e08e85905540371ec6138b213a756ff884946dcb50ce78358
    plan-execution §3: sec-v1:sha256:6eeb56b26fda91768ef4936acc042f652ec5457b1d2c457c3f3472ffa3f3e992
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
    harness R35: sec-v1:sha256:8b1e737add27eec7e74590dc6f9ebcc4783eb590989cf0a6fe385d3318509673
    harness R35.1: sec-v1:sha256:ad8d4e7fe9a3b9752ae87aebd0f898c61a5b6b2cb6765bed056ffa7fb8a82ce3
    harness R47: sec-v1:sha256:00141da5fe320b391ee24b77a44a26f4771c990c0fc6df86dc6bb6bad7596471
    harness §2: sec-v1:sha256:eefbd6e7b229444096ca07b84f193102a1583c6fefa9a2cc93f290f1d92746c2
    steering R51: sec-v1:sha256:b3c2c9caabca37dd96851061c01a1d38acbb1c1ecfb56c76a8f674ccd8f86ae7
    steering R59: sec-v1:sha256:7078d03a4c2a8767271e37f7c1b6ed4551ee563aa732399d8e620e759d99deb4
    steering R59.1: sec-v1:sha256:51c5ce271e04fa5e30d6868c79bb729f9150cbcfc9b225452e358924bf74fff4
    steering R22: sec-v1:sha256:d9f839de1060ffe4c0024af136b6c2e35bf75114240139440381280fb00bfc5a
    steering R23: sec-v1:sha256:e9813d1b21b35b1f55a819fc307219a95c0c7e3a3a1edeacd694fc2084eecffb
    cli R17: sec-v1:sha256:fa2eada9b0354af5dec295777726f589bb0ec8c867fd3bf825008ebfdb5e5e85
    cli R33: sec-v1:sha256:c86a7050f2087682d9f066caf12bce4be1ab54dfd5f4f150c277f4cd03b42db3
    cli R33.1: sec-v1:sha256:ae2cf8e63061ee47accfec7bf11989137a2ead77df4909ed2cd302a48fe6529f
    verification R32: sec-v1:sha256:82af1b10e390df0f58d4a6b8438ae3b1e8e8d6a38bc199e0157d908d2818d6ee
    verification R36.3: sec-v1:sha256:3722680661e2c665ab60bbd97cb7be939cd4277cda53d29cdb843db65fe2e657
    roles-and-permissions R43: sec-v1:sha256:48d9826db3b6bf231c2843cd8d7d58e2ab81caa3592359a87dbad3230b1c928a
    roles-and-permissions R49: sec-v1:sha256:a2890687e9f43b25a30c558aa2263a13ab7fa9fdee7e2e8f5781cd3326953a2e
    roles-and-permissions R55.1: sec-v1:sha256:20e7beb17ecd21102737f574b1c3c473e5861fa13d8db5d7723956088f7f2daf
    roles-and-permissions R58: sec-v1:sha256:d7ec215e8a95f13439d06e3727cf9048f635da9c3bf3b6f993671f6edf3944ff
    later-releases R37: sec-v1:sha256:a56a6805e16e75b483b3459d08775ee9b700b0a479a8daa05075a6a014facc23
    later-releases R39: sec-v1:sha256:d4c8c3775db38dd07768b63a6a9d085d73723488c312455662e303036230dd47
    later-releases R66: sec-v1:sha256:4823baaaf41764de05ddbc443f4ab56a802c6dd7471ce716ade405dcdbdad17d
    plan-execution R31.2: sec-v1:sha256:451758ee1a6bb0b41cc11814fddf4f249bf56481d6e0806cf8af467e011e3257
    harness R21: sec-v1:sha256:29265391e74a2e38b2e0d878e9ed8777cc8c9604a0f7f8a292e5ae1ece5bb7a4
    harness R38: sec-v1:sha256:b07470de151d828b12dcf666d5d17ba92823d0efda29d6eb7af0e7f8bfd206fb
    roles-and-permissions R44.1: sec-v1:sha256:de2157fc4b7cadad8daf8b776e801dc4e77ece1990d5623190b16287527da0f5
    roles-and-permissions R60: sec-v1:sha256:36c4d42ffcb7ffd8095a3abeb3cce9622fa419b3288b895790548743e3a30ae2
    harness R21.1: sec-v1:sha256:5cfe313c29b3c376159a0e7c7ab1170436833cb02fe2f698214329bbfbb3773f
    harness R38.1: sec-v1:sha256:40f4e34c0d4f250f6803e061067c62c0f626620ca90c088a730ab61fa014d3b5
    later-releases R37.1: sec-v1:sha256:0508b51774b201c58acd6597b54574c1549590b4ea1e02bf0d3a08854eb7861e
    later-releases R39.1: sec-v1:sha256:9eb4823dda4fde17b2ab45538e2b030542aa1eff9befc000ad26762e33c50dae
    later-releases R39.2: sec-v1:sha256:6ded59bdfb31cc35266951435bf7168dc49d47b375b80adce9a9708327f83147
    later-releases R39.3: sec-v1:sha256:efd0ff149f6b08376a66c0e028c93620ac0007d89af7e7107ae502ad6ea9c77e
    later-releases R39.4: sec-v1:sha256:d36dd9f5f211db87ecf12a7092bc5424b0deb87ffabc74fe81f20b0ff0bc2681
    cli §2: sec-v1:sha256:017f8f9d8b9afa8a9ec36236b45575419e40cc4436978a31ba729b0107159d67
    architecture/file-formats §6.2: sec-v1:sha256:f5b399a6cfe3e2abba557492288674a0a28bc9eca0e026cf1b470af26d8aef38
    architecture/repository-layout §3: sec-v1:sha256:07aa7d37c8bb828d9a3ecd3966c22e2ac4b67b62ff0f8e44e8dcc81c18382b8e
    architecture/repository-layout §2: sec-v1:sha256:8fafc6d52d8d6599a82ed03b345c6195d19925ffa7304196e4ccb5908b740c8e
    architecture/file-formats §6: sec-v1:sha256:cbc88aed84ec3893fcedcb07e2e6c7e407be30813b03d06203748e64f17c860b
    configuration §2: sec-v1:sha256:5a272b03d8faafa350a3e65f11279d9f04be0f0b4fb462ce7b56cd622c87a4bd
    architecture/file-formats §9.2: sec-v1:sha256:66488f3eb6db66f625db3f8710d638e7a861bbd831701f1ce865a45a53ac31a9
    architecture/repository-layout §1: sec-v1:sha256:871af15d90d277dfc006775a6de7c339d67d81832d9ba98967f281ba96b8bde9
    architecture/file-formats §9.1: sec-v1:sha256:2123852ca40d41718dca99f00354036836baa2181976df2b43cd0eaf64ff2fc1
    architecture/file-formats §2.1: sec-v1:sha256:5dadb0010c15363bb675291c3963d971445ba681a0081c0ba7a7014691cfe5c2
    architecture/file-formats §1.1: sec-v1:sha256:52a074161abd76dcdd1f6de11d2bc87d16dc4b3ac28eb3f270108ba8ba4cc1a5
    architecture/file-formats §3.3: sec-v1:sha256:3eaa7d6b68fc111e44c496e3d8f17116355e0860b9bd0966b249ee730b8193b6
    architecture/file-formats §11.2: sec-v1:sha256:73e1f9556e2200f1e371ecd30c9329372a67096b450a3c56112e1c7585727151
    architecture/file-formats §3.1: sec-v1:sha256:f12cfd6d43ecfe4a3d8c618aaa42e1312c3f1a63e4f0041e511e3d1e50c6bf04
    architecture/file-formats §3.2: sec-v1:sha256:a0936634c2da7a7d46fe19d0abdedd36aafdf8f1c9ee873daf28ba10afe3819b
    architecture/file-formats §3.4: sec-v1:sha256:41aca001648dce6f007529e00ab06186005b207fe1942e36ccced0ba79439201
    architecture/file-formats §5.2: sec-v1:sha256:88fd50010e236ce382da2f4d73b2245c96c040490fe872558da40fcbb78facdd
    architecture/file-formats §1.2: sec-v1:sha256:212cc0a07b47a3988c0d088031bf8728046b3c6254bb742f1e8c0bf0c9e679a4
    specifications R2: sec-v1:sha256:9c38dd0e8485499de74f9e02965fcdb69355f53d1e9b4f99f77957973e83e914
    specifications R68: sec-v1:sha256:06be08d4092f55d9bdca6f0c9b26cea80d2b3f5544ad1afcada0eb7c06e56682
    architecture/file-formats §4.2: sec-v1:sha256:f88872c868d19c58643a986374a61a156007c5ef5a7fb36ca960ea6cecab41de
    architecture/file-formats §4.5: sec-v1:sha256:076a224335feb22cb516a25c6719b6200bea2c446a78b4a7382110b3bcaa1edc
    architecture/file-formats §2.4: sec-v1:sha256:507cec098ec7172e105dfaf4affa3d878e351c9b95e2cca972046fc3d1b0b8fb
    architecture/file-formats §2.2: sec-v1:sha256:ba48c67b26563ff9d699c077c336ad493d9fa250cb5a92b346ec6eaadfd8e4cd
    architecture/file-formats §2.3: sec-v1:sha256:82d2a14bb094a7d004956d46528011f2b82068651369beb0b157b472c4d78f01
    architecture/file-formats §8: sec-v1:sha256:d8d0449317d55d4f8e17b5713724484b53dfc15fd9ee22cc60ee60c066638288
    architecture/file-formats §2.5: sec-v1:sha256:c8fe33cc951c8ac9d5d1c1d5475f9b4807c71521fc947e3ff165bc5c6cedcfee
    architecture/file-formats §2: sec-v1:sha256:d2cd0ed99afd5ceb30608b0df82122405903c9d1a5a34112ca5d421ebaf8a2a9
    specifications R4: sec-v1:sha256:cd3d9f4708e83188bb585d825b4e678ddbeb0f889bbd892a17bfcf712ad93eb3
    architecture/file-formats §5.3: sec-v1:sha256:63af0b84f5089abaaa0566a77760dd63e830c499cfa0728b19a98f87bd836a09
    architecture/file-formats §11.3: sec-v1:sha256:796cfc95de2dc84b14f5792456c7c09169a79a63628430cb8b721f4eacf57418
    R62: sec-v1:sha256:4d9170cfe4a72440bf9a1c6e24312cb163a21149a95c67a503819645505b30a8
    R63: sec-v1:sha256:0faee28d5cade6745e72beaa4015ce3510c9bb4907881a8009174d4ddd25cd1e
    architecture/file-formats §7.1: sec-v1:sha256:0ca3d62426f31f188bdb00af1b1416d08cbd5553922fa8d5829b2b26453abf85
    architecture/file-formats §7.2: sec-v1:sha256:d22359bc49e2a0c913449f836ecb98e12d6df5eae6e66ae4568f1850c9dfd1b3
    roles-and-permissions §2: sec-v1:sha256:e14c6ef033b445261b57332bf2eb941691aae0ac6d1c884fa4e9a594470000af
    requests §2: sec-v1:sha256:5479166b365b32bbbba3ebaaf5989bb8e0c12bd160daf5876a5398fb33701d1d
    architecture/file-formats §10: sec-v1:sha256:0c5b7b9da9d011bb4fb9d3b96fdd8d81a9085f4d6f4a6f0f4fbc1f9f570f1688
    verification §2.1: sec-v1:sha256:de405e11ecf063b5af8daa02b02ac239cd0b36ada68fd8be1d5381310b806cea
    verification §2.2: sec-v1:sha256:f880f242c42f7a42d77212cfa0b74dc9fc7d38eb0d970b3a78026c10bb3edecc
    architecture/file-formats §11.1: sec-v1:sha256:dc1885c43900bb6051a312fdcbea7efae4db59eaa6b56e45ddb4fc5a569e440b
    architecture/file-formats §11.4: sec-v1:sha256:7bbea71572f76bac353791a5ff23eb3cf9e451f698ed25c1444461221dfce04e
    architecture/file-formats §5: sec-v1:sha256:3805a4b92aa93eaa822430d9ced067169c94645fc60f2d4bfd7099b86bcba22c
    architecture/file-formats §5.5: sec-v1:sha256:ac99e922ad883c71b7065b4a748bdf8260d762e8f74d0005b40aa2abba671d77
    architecture/file-formats §5.4: sec-v1:sha256:af1aaee1b478b0658724280a75836fd63d4931acc621248556bc78fbd1a09e92
    architecture/file-formats §5.1: sec-v1:sha256:fae1466ddf28a62885d7ee92811f30257bfefae1fcc0a0e6e5b826178a681821
    architecture/repository-layout §5: sec-v1:sha256:ca976eb0ae0164a4df6cb6bb0daa8b5d1574f63a96764b5debcf13142788f916
    harness §3: sec-v1:sha256:45f449d3ef356b5aad71d6bd05ecb2c2dfd5b35b26ddfe84b47b3ab61023d6d0
    architecture/file-formats §7.4: sec-v1:sha256:8fd5e15388a1f0fba4657bdaee86f92a2bfbff4146d6f403f82ef8bafe9982b9
    architecture/file-formats §12.4: sec-v1:sha256:f89e302b825759462fbd6dbae3f1a6050d082efe3ad8b981cd4b8051e67c0be9
    architecture/file-formats: spec-v3:sha256:1305925260c4b6989455012c2ad9c2f654a922141eaa07c4a8fcf89cb56be40d
    architecture/repository-layout: spec-v3:sha256:c61e14edc80cfe585fa85ca11aff3edc27e466d9d25e0fa8ff144c8003e80868
    architecture/agent-skills: spec-v3:sha256:f554d210a575ff6e9aa95a722fc5d9d74a04e0f86cbfc57d840897d204c222df
    plans: spec-v3:sha256:ee503b432bd8f546a8ee56fc1760b2b2e6f15e35ffc53eb072c08e8c22b12063
    harness: spec-v3:sha256:6c43e85e8bd1cdfd612819ee4fe250607065f775d29dd735ca8f15b8d91b8430
authors:
  - llm: claude-sonnet-5-5
    contribution: drafted
implements: [cli R16, harness R34, configuration R25, configuration R25.1, plan-execution R27, specifications R1, specifications R5, specifications R7, specifications R9, specifications R10, specifications R10.1, specifications R11, specifications R11.1, specifications R11.2, specifications R11.3, specifications R11.4, specifications R40, cli R16.1, verification R12, verification R24, verification R24.1, verification R64, configuration R54, roles-and-permissions R42, roles-and-permissions R42.1, roles-and-permissions R42.2, roles-and-permissions R44, roles-and-permissions R46, roles-and-permissions R50, roles-and-permissions R55, roles-and-permissions R56, roles-and-permissions R56.1, roles-and-permissions R57, cli R17.1, cli R17.2, requests R52, requests R52.1, requests R52.2, requests R52.3, requests R52.4, requests R52.5, plan-execution R27.5, plan-execution R27.5.1, plan-execution R27.5.2, verification R13, verification R13.1, verification R36, verification R36.1, verification R36.2, verification R61, verification R61.1, verification R61.2, verification R61.3, verification R61.4, verification §2, verification §3, plans R28, plans R28.1, plans R29, plans R29.1, plans R29.2, plans R29.3, plans R30, plans R30.1, plans R69, plans §2, plans §2.1, plans §2.2, plans §3.1, plan-execution R27.1, plan-execution R27.1.1, plan-execution R27.2, plan-execution R27.2.1, plan-execution R27.3, plan-execution R27.4, plan-execution R27.6, plan-execution R31, plan-execution R31.1, plan-execution §2, plan-execution §3, harness R14, harness R18, harness R19, harness R19.1, harness R19.2, harness R20, harness R20.1, harness R26, harness R26.1, harness R26.2, harness R35, harness R35.1, harness R47, harness §2, steering R51, steering R59, steering R59.1, steering R22, steering R23, cli R17, cli R33, cli R33.1, verification R32, verification R36.3, roles-and-permissions R43, roles-and-permissions R49, roles-and-permissions R55.1, roles-and-permissions R58, later-releases R37, later-releases R39, later-releases R66, plan-execution R31.2, harness R21, harness R38, roles-and-permissions R44.1, roles-and-permissions R60, harness R21.1, harness R38.1, later-releases R37.1, later-releases R39.1, later-releases R39.2, later-releases R39.3, later-releases R39.4]
references: [cli §2, architecture/file-formats §6.2, architecture/repository-layout §3, architecture/repository-layout §2, architecture/file-formats §6, configuration §2, architecture/file-formats §9.2, architecture/repository-layout §1, architecture/file-formats §9.1, architecture/file-formats §2.1, architecture/file-formats §1.1, architecture/file-formats §3.3, architecture/file-formats §11.2, architecture/file-formats §3.1, architecture/file-formats §3.2, architecture/file-formats §3.4, architecture/file-formats §5.2, architecture/file-formats §1.2, specifications R2, specifications R68, architecture/file-formats §4.2, architecture/file-formats §4.5, architecture/file-formats §2.4, architecture/file-formats §2.2, architecture/file-formats §2.3, architecture/file-formats §8, architecture/file-formats §2.5, architecture/file-formats §2, specifications R4, architecture/file-formats §5.3, architecture/file-formats §11.3, R62, R63, architecture/file-formats §7.1, architecture/file-formats §7.2, roles-and-permissions §2, requests §2, architecture/file-formats §10, verification §2.1, verification §2.2, architecture/file-formats §11.1, architecture/file-formats §11.4, architecture/file-formats §5, architecture/file-formats §5.5, architecture/file-formats §5.4, architecture/file-formats §5.1, architecture/repository-layout §5, harness §3, architecture/file-formats §7.4, architecture/file-formats §12.4, architecture/file-formats, architecture/repository-layout, architecture/agent-skills, plans, harness]
---

# Reference CLI

This spec says how the reference implementation of Specplane is built: the technology, the module structure, how a repository and its configuration are loaded, how specs are parsed and cites resolved, how fingerprints and approvals are computed and checked, how validation, warnings, permissions, requests, the audit log, tests, plan flows, harness actions and human commands work, and which checks run in pre-commit hooks and CI. File contents are in `architecture/file-formats`; where files live is in `architecture/repository-layout`. The way harness text, steering and instructions are delivered is in `architecture/agent-skills`. Each section states which feature sections it implements. Details the feature specs leave open are marked "assumption". Items for later releases are marked "later release" and are not built first.

## §1 Technology choices

Implements `harness R34`.

- **Language and runtime.** TypeScript on Node.js 22 or later, compiled with `tsc` to `dist/`. The package is `specplane` on npm with one binary, `specplane`. Tests run through the repository's test script (`AGENTS.md`).
- **One core, several front ends.** All behaviour lives in a core library that never prints and never reads the terminal. Three thin front ends call it: the CLI (people), the harness adapter (the LLM, `§12`) and the user-command runner of a harness (a person typing a harness command, `§12.2`). The front end decides which role the call runs under (`§7.1`); the core never guesses it. This is what makes "same checks everywhere" (`cli §2`) true by construction.
- **Libraries.** `commander` for command routing and help; `yaml` (the eemeli library, YAML 1.2, comment-preserving document API) for reading and writing frontmatter, configuration and progress files, replacing `js-yaml` and `gray-matter` of the earlier build (assumption: round-trip writes are needed, `architecture/file-formats §6.2`); `ajv` with `ajv-formats` for the JSON records of the local store and the configuration schema. No native dependencies.
- **Git and forge.** The `git` command, started without a shell and with a fixed environment (`LC_ALL=C`, no pager, no prompts). The `gh` command is used only to open a pull request, and only when it is installed (`§11.7`). No git library is used.
- **Determinism.** The CLI and core never call an LLM. Intelligent checks are carried out by an LLM in a harness and recorded through the core (`§10`).
- **Time and randomness** (dates, ID suffixes) come from one injectable clock and random source, so tests are reproducible (assumption).
- **Output.** Every command produces a result object; one formatter prints it as text and another as JSON (`--json`). See `§13.3`.

## §2 Module structure

Implements `harness R34`. Names are the target structure; the current code under `packages/cli/src` is moved toward it, and modules of removed features (overlays, pins, leak guard, ADR parsing, `PLANS.md` generation, forge restack, the conductor and writer-lease machinery) are deleted.

```
src/
  cli.ts                    entry point, registers commands
  repo/        repo.ts      checkout root, main root, git common dir (§3.1)
               config.ts    load, validate, edit configuration (§3.2)
               store.ts     local store under the git common dir (§3.3)
  spec/        frontmatter.ts   split and parse frontmatter, round-trip edit (§4.1)
               sections.ts      headings, section ranges, Test lines (§4.2)
               cites.ts         extract and resolve cites (§4.3)
               requirements.ts  requirement markers and retired IDs (§4.4)
               project.ts       load the project snapshot (§4.5)
               fingerprint.ts   spec-v3 and sec-v1 (§5.1)
               status.ts        effective status, outdated reasons (§5.2)
               approve.ts       groups, checks, approval write (§5.3)
               metadata.ts      metadata read, write, overrides (§13.2)
  verify/      validate.ts      rule registry and runner (§6.1)
               rules/*.ts       one file per rule family
               warnings.ts      warnings collector, auto-warn line (§6.3)
               coverage.ts      coverage views (§6.4)
               tests.ts         test declarations, run, record (§10)
               implementation.ts  mark implemented (§10.4)
  perm/        catalog.ts, presets.ts, roles.ts, guard.ts, docs.ts (§7)
  requests/    store.ts, accept.ts (§8)
  audit/       log.ts, retention.ts (§9)
  plan/        parse.ts, validate.ts, progress.ts, next.ts, start.ts, stop.ts,
               resume.ts, budget.ts, review.ts, finish.ts, abandon.ts, merge.ts,
               worktree.ts (§11)
  harness/     actions.ts, adapter-claude.ts, adapter-codex.ts, instructions.ts,
               retrieve.ts, steering.ts, install.ts (§12)
  git/         exec.ts, blobs.ts, commit.ts, worktree.ts, hooks.ts (§1, §14)
  docs/        bundle.ts, search.ts (user and AI-facing documentation, §12.5)
  output/      text.ts, json.ts (§13.3)
  errors.ts, types.ts, clock.ts
  commands/    one file per command group, each only maps arguments to core calls (§13)
```

Rules: `spec/`, `verify/`, `plan/` and `requests/` never import from `commands/` or `harness/`; every write operation in the core takes an `Authorized` value that only `perm/guard.ts` creates (`§7.3`); only `repo/store.ts` writes into the local store and only `git/exec.ts` starts processes.

## §3 Repository, configuration and local store

Implements `configuration R25`, `configuration R25.1`, `plan-execution R27`.

### §3.1 Roots

- `checkoutRoot()` is `git rev-parse --show-toplevel` of the directory the command runs in; configuration, specs and plans are read relative to it, so a command run in a plan worktree sees that branch's files.
- `mainRoot()` is the parent directory of `git rev-parse --path-format=absolute --git-common-dir`; it is used only for `plans.worktree_dir` and the project folder name (`architecture/repository-layout §3`).
- `storeDir()` is `<git-common-dir>/specplane` (`architecture/repository-layout §2`).
- Outside a git repository, commands that need git fail with `NotARepoError`. `specplane docs` and `specplane --help` do not need a repository.

### §3.2 Configuration

- `config.ts` reads `.specplane/config.yaml` from `checkoutRoot()`; a missing file means all defaults. The result is a fully populated `Config` plus a list of findings (unknown key, wrong type, non-positive number, unusable path, missing permission or preset) from the schema in `architecture/file-formats §6`, `§6.1` and `§6.2`. A bad key is dropped and its default used; the loader never throws on content (`configuration R25`).
- The loader runs once per command and the `Config` object is passed down; nothing re-reads it mid-command, so a change applies from the next command.
- Writing: `config set <key> <value>` and `config unset <key>` edit the YAML document in place (comments and key order kept), validate the new value against the schema before writing, and write through a temp file and rename. A setting set to its default is written as given (`configuration §2`).
- Every write is a guarded operation with permission `config.change` (`§7`). Under `request-user` the request holds `params: {key, old, new}` (`architecture/file-formats §9.2`). The audit entry carries `old` and `new` (`§9`). Setting `permissions.preset` is the same operation.
- Side effects of a setting are applied by the same operation: turning `pre_commit.*` on or off installs or removes the hook section (`§14.2`); changing `permissions.preset` triggers steering regeneration (`§12.4`).
- Reading is unguarded and lists every key with its value, whether it is set or default, and its default (`configuration R25`). Settings for later releases are accepted and shown, with a note that they have no effect yet.
- Terms of the old model are reported as unknown settings (`architecture/file-formats §6.2`).
- Assumption: `paths.*` and `plans.dir` are resolved and checked once at load time (inside the repository, not overlapping, `architecture/repository-layout §1`) and the checked absolute paths are what the core uses.

### §3.3 Local store

`repo/store.ts` is the only code that touches `<git-common-dir>/specplane/`. It creates the directory on first write, treats missing files as empty, writes JSON and YAML files through a temp file and rename, and appends audit lines with one `write` of a complete line (`architecture/repository-layout §2`). Files and their formats are those of `architecture/file-formats §9.1` and `§9.3`: `requests/`, `audit.jsonl`, `logs/`, `worktrees.json`, `runs/` (run marker, `§11.3`), `reviews/` (target commit seen by the final review, `§11.6`), `sessions/` (instructions already delivered, `§12.3`), `role.json` (the Administrator switch, `§7.1`) and `tmp/` (temporary checkouts, `§10.2`, `§14.2`). Plan budgets are not here: they are plan metadata (`architecture/file-formats §5.4`).

## §4 Specification parsing and cite resolution

Implements `specifications R1`, `specifications R5`, `specifications R7`, `specifications R9`, `specifications R10`, `specifications R10.1`, `specifications R11`.

### §4.1 Frontmatter

`frontmatter.ts` splits a file at the first line `---` and the next line that is exactly `---`. The block is parsed with the `yaml` library in the core schema with unique keys and no custom tags; dates stay strings (`architecture/file-formats` intro). The result is `{data, bodyOffset, raw}`. A file whose first line is not `---`, whose block does not parse, or whose required fields are wrong yields a `FormatFinding` and the spec is marked invalid; it is still listed and never silently skipped (`verification R12`). Field rules are those of `architecture/file-formats §2.1`. `INFO.md` is read as plain markdown and reported only when it has frontmatter (`architecture/file-formats §1.1`).

Editing writes back through the YAML document so untouched lines are byte-identical; only the named keys change. A spec's body is never rewritten by metadata operations. Authors are appended, never reordered (`specifications R10`, `specifications R10.1`).

### §4.2 Sections

`sections.ts` scans the body line by line, ignoring fenced code blocks, and builds an index of ATX headings. A citable heading matches the grammar of `architecture/file-formats §3.3`. The index maps each section ID to `{level, startLine, endLine}`, where `endLine` is the line before the next heading of equal or lower level. Duplicate section IDs and a child under the wrong parent are reported. The same pass collects `Test (deterministic):` and `Test (intelligent):` lines per section and numbers them (`architecture/file-formats §11.2`).

### §4.3 Cites

- **Extraction.** `cites.ts` finds inline code spans outside fenced blocks whose whole content matches the cite grammar of `architecture/file-formats §3.1`, and reads the frontmatter lists `covers`, `implements`, `references`. Each cite records the file and line for messages. A cite inside the section that defines it is dropped (`architecture/file-formats §3.2`).
- **Resolution** follows `architecture/file-formats §3.4` exactly, in this order: project, then requirement or spec file, then section. The result is `{kind, file, startLine, endLine, text}` or an error with a reason (`requirement not found`, `retired`, `duplicate`, `spec not found`, `section not found`, `unknown project`).
- **Where text is read from.** Resolution takes a `Source`: `committed(rev)` reads blobs with `git cat-file --batch` (one process for the whole run), `worktree` reads files. Status uses `committed(HEAD)`, format checks use both (`§5.2`, `§6.1`).
- **References check.** For each spec, the set of cites found in the body must be a subset of `covers` plus `implements` plus `references`, and the reverse is a warning (`architecture/file-formats §2.1`, `specifications R9`).
- **Dependencies.** The dependency set of a spec is the resolved targets of those three lists. Plans add `plan/<id>` and `file:<path>` targets (`architecture/file-formats §5.2`, `§12.3`). The dependency graph is built once per snapshot and used for approval groups, plan cycles and coverage.

### §4.4 Requirements

`requirements.ts` finds the central file by the rule of `architecture/file-formats §1.2` (reporting zero or several candidates) and parses the requirement files it names: marker lines, ID tree, retired list, and each requirement's text range including sub-requirements (`architecture/file-formats §1.2`, `§1.3`). It reports duplicate IDs, retired IDs in use and orphan sub-IDs (`specifications R1`). It never writes the requirements page (`specifications R2`). The "next free ID" helper used by harness actions is highest ever used plus one.

### §4.5 Project snapshot

`project.ts` loads, for a given `Source`, the requirement files, every spec in `paths.features` and `paths.architecture`, and the plans in `plans.dir` and its archive, then the index of sections and cites. Layers that are absent are empty, never an error (`specifications R68`). The snapshot is immutable and shared by validation, status, coverage, retrieval and the final review. The snapshot at HEAD is cached for the life of one command.

## §5 Fingerprints, status and approval

Implements `specifications R11`, `specifications R11.1`, `specifications R11.2`, `specifications R11.3`, `specifications R11.4`, `specifications R40`, `cli R16`, `cli R16.1`.

### §5.1 Computing fingerprints

`fingerprint.ts` implements `architecture/file-formats §4.2` and `§4.3`:

- `specFingerprint(text)`: parse frontmatter, drop `status`, `approval`, `authors`, `review-reason`, `results`, `implementation`, `title`, `covers`, `implements`, `references` (metadata, `cli R17`), serialise `{frontmatter, body}` as canonical JSON (keys sorted by code point, no whitespace, literal Unicode), SHA-256, prefix `spec-v3:sha256:`. The body is the text after the closing fence with CRLF and CR turned into LF.
- `partFingerprint(text)`: LF-normalised part text, trailing blank lines removed, prefix `sec-v1:sha256:`. A whole-spec cite uses `specFingerprint` of the cited file. An unresolved cite has no fingerprint.
- `planFingerprint(text)`: the same procedure over PLAN.md, keeping those four keys, with the `commit` of every `implements` entry removed as well, prefix `plan-v1:sha256:` (`architecture/file-formats §5.2`).
- Canonical JSON is a small local function (about 30 lines) rather than a library, so the byte output is fixed by this spec and not by a dependency version (assumption). Fingerprint prefixes are versioned; an unknown prefix in a record is reported and treated as changed.

### §5.2 Effective status

`status.ts` implements the algorithm of `architecture/file-formats §4.5` over `committed(HEAD)` and returns `{status, reasons[], notes[]}`:

1. Read the spec blob at HEAD. No approval, or stored `awaiting-review`: `awaiting-review` with reason `never-approved`.
2. Compare `specFingerprint` of the HEAD content with `approval.fingerprint`. Without a stored fingerprint (hand format), read the blob at `approval.commit` instead; a commit that is not in history adds reason `edited` and a note that approval cannot be checked.
3. For each entry of `approval.cited`, resolve the cite at HEAD and compare part fingerprints; a difference, or no resolution, adds `outdated: <cite>`. A dependency not in `cited` was added after approval and is not compared (metadata, `architecture/file-formats §4.5`). **When `approval.cited` is absent (hand format)**, for each dependency that is in the frontmatter at `approval.commit`, resolve it a second time with `committed(approval.commit)` and compare the part fingerprint there with the one at HEAD; a target that does not resolve at that commit counts as changed. Dependencies added after that commit are not compared. The next `spec approve` of the spec writes `fingerprint` and `cited`, after which this branch is no longer used (`architecture/file-formats §2.3`).
4. A requirement-file dependency is compared the same way; a requirement file without approval data is never itself a reason.
5. Each dependency that resolves to a spec file with no `approval` block at HEAD adds `unapproved-dependency: <cite>` (`specifications R11`). It reads only whether the block exists, so `specifications R11.2` is not affected by unrelated changes in the cited spec.
6. If the working tree file differs from HEAD, add the note "uncommitted changes are ignored" (`specifications R40`).
7. An approval with an `override` mark is treated like any other approval: it carries the fingerprints that `override status` wrote from the content at that moment, so a later content or cited-part change returns the spec to `awaiting-review` (`cli R17.2`, `architecture/file-formats §2.4`).

**Test (assumption, deterministic):** a fixture spec in the hand format whose cited parts are unchanged since `approval.commit` stays `approved`; changing one cited part gives `outdated: <cite>`; a spec citing a spec with no `approval` block gives `unapproved-dependency: <cite>` and a spec citing a spec that has one does not.

Statuses of many specs are computed in one pass over the shared snapshot, so listing the project costs one `git cat-file --batch` process. Stored and computed values that differ produce the warning of `architecture/file-formats §2.2`; commands that write approval or review state keep them in step.

### §5.3 Approval

`approve.ts` implements `cli R16`. Inputs: spec IDs (IDs only, never natural language) and options `--yes`, `--no-commit`.

1. **Resolve and expand.** Resolve each ID to a spec file. Build the dependency graph among specs and take strongly connected components: the group of a named spec is its component, so a spec that cites a cycle without being cited back is not in it (`cli §2`). The union of the groups of all named IDs is the set to approve.
2. **Checks, all collected, none stopping the others** (`cli R16`):
   - the role holds `spec.approve` as `allow` for every member (`cli R16.1`); under `request-user` one request is created for the whole set and nothing else runs (`§8`). Pending the requests step: the reference build only refuses under `request-user`, says requests are not available yet, audits `refused` and creates no request;
   - each member's file is committed and unchanged in the working tree;
   - every cite resolves; a missing part is named;
   - each dependency outside the set is effectively `approved` at HEAD (requirement files are exempt, `§5.2` item 4, assumption: the page owner approves requirements);
   - no member has a current failed test result (`verification R61.1`, `§10.3`);
   - the stored status of a member that is already effectively approved is left alone. If its approval lacks `fingerprint` or `cited` (hand format), the command re-records them: `fingerprint` and `cited` are computed from the HEAD content and added to the existing block, and `by`, `date`, `commit` and `note` are kept (`architecture/file-formats §2.3`). Approving only members that are approved with both fields does nothing and says so.
3. **Confirm.** When the set has more than one member, print the list and ask; `--yes` skips the prompt. Without a terminal and without `--yes` the command refuses (assumption).
4. **Write.** If any check failed, nothing is written and every reason is printed. Otherwise, for each member, compute `approval.fingerprint` and `approval.cited` from the HEAD content, find `approval.commit`, and write the block (`architecture/file-formats §2.3`, `§4.4`): `by` from git `user.name` (an LLM approver is `{llm, delegated-by}`), `date` from the clock, `status: approved`, and removal of `review-reason`. Members of one group get the same `by` and `date`.
5. **Content commit.** `approval.commit` is found by walking `git log --format=%H -- <path>` newest first and taking the last commit whose `specFingerprint` equals the current one before the first that differs.
6. **Commit.** Assumption (the page does not say that approval commits; rule in `§13.4`): one commit contains exactly the written files, with message `docs(specs): approve <id>` and the trailers of `architecture/file-formats §8`; `--no-commit` leaves the edit staged. The approval counts once it is committed (`specifications R40`).
7. **Audit.** One entry per member (`§9`).

Approval from the harness is the same function with the LLM role (`§12`); only the guard result differs (`harness R20`, `harness R20.1`).

### §5.4 Review state writes

When the CLI or core writes a spec because a content edit made it stale (`specifications R11.3`, `specifications R11.4`), it sets `status: awaiting-review`, removes `approval` and writes `review-reason` from the computed reasons (`architecture/file-formats §2.5`). Plain `git commit` of a hand edit does not do this; the effective status is computed on read, and a stored value that disagrees is a warning (`§6.3`). `spec reopen <id>` (human, guarded by `spec.edit.<type>`, assumption) performs the write without changing content and commits it by the rule of `§13.4`.

## §6 Validation, warnings and coverage

Implements `verification R12`, `verification R24`, `verification R24.1`, `verification R64`, `configuration R25`, `configuration R54`.

### §6.1 Validation engine

- **Rules.** `verify/rules/` holds one module per family, each exporting `rules: Rule[]` with `{id, severity, source, run(snapshot) -> Finding[]}`. A runner executes every rule on the snapshots it needs and sorts findings by file and line. Families: `spec-format` (`architecture/file-formats §2`), `cites` (`§4.3`), `requirements` (`§4.4`), `plans` (`§11.1`), `status` (`§5.2`), `tests` (`§10`), `config` (`§3.2`), `permissions` (`§7.4`), `harness` (`§12.6`).
- **Finding** is `{severity: error|warning|note, rule, message, file, line, section, source: committed|worktree}`. Errors are things that make a file unusable: unreadable or invalid frontmatter, ID/path mismatch, unresolved cite, missing reference entry, duplicate or reused requirement ID, plan ID/folder mismatch, plan reference cycle, unreadable step, unreadable result record. Warnings are project-state findings: uncovered items, outdated specs and results, outdated plan references, listed-but-unused references, stale stored status, harness and steering staleness, permissions without documentation, unwritable audit log.
- **Committed and working tree.** Status, outdated and test-state rules read `committed(HEAD)`. Format rules run on both and a finding says `worktree` when the file differs from HEAD (`verification R12`).
- **Scope.** The command takes zero or more spec or plan IDs and then checks only those and their cites.
- **Exit status.** 0 when there are no errors, 1 otherwise; warnings never change it. `--json` prints the findings list and counts (`§13.3`).
- **Read-only.** The runner receives a snapshot and no writer; it cannot write files, status or the store except the audit entry of the run (`§9`).
- **Intelligent checks** (separation of layers, `specifications R4`) are not rules. They are instructions delivered by the harness (`harness R14`); an LLM may record results as warnings through the `warnings.report` action (`§12.1`, assumption), shown in the warnings list for the current session only.
- **No requirements, plans or later layers** produce no findings (`specifications R68`, `plans R69`).

### §6.2 Rule details worth fixing here

- Cites inside plans follow the same resolver; `file:<path>` must exist, and a `context` file that does not exist yet is a warning (`architecture/file-formats §5.3`).
- A plan reference cycle is found with Tarjan's algorithm over `plan/<id>` edges and reported naming the members.
- A spec with `covers` on an architecture spec, or `implements` on a feature spec, is an error (`architecture/file-formats §2.1`).
- `implementation` on a non-architecture spec is an error (`architecture/file-formats §11.3`).
- A summary in a result that matches the credential heuristic (token names such as key, secret, password; strings of 32 or more base64 or hex characters) is a warning, never an error (`verification R61.3`).

### §6.3 Warnings collector

`warnings.ts` merges two kinds of source into one list: warning findings from the rules above, and checks that are not validation: audit log not writable (set by the audit writer during the command), harness installation missing or older than the installed Specplane (`§12.6`), steering stamp older than the active preset or steering (`§12.4`), permission without documentation or steering (`§7.4`), pre-commit setting on with no hook installed (`§14.2`). Each warning is `{text, subject: spec|plan|permission|installation, why}`. The list is recomputed on every call and nothing is stored or dismissed (`verification R24`). `specplane warnings [<id>]` narrows to one spec or plan. A warning never blocks.

**Auto warn** (`verification R24.1`): the command runner, after the command's own result is final, calls the collector when `auto_warn` is on and appends the count as the last text line, worded `N warnings; run `specplane warnings`` (`0 warnings` when none; `verification R24.1` requires only the count, the wording is an assumption). In JSON output the count is a top-level `warnings` field and the data is untouched. Failure of the collector never changes the command's status; it prints `warnings unavailable` (assumption). Harness adapters add the same count to the result text they return to the LLM.

### §6.4 Coverage

`coverage.ts` builds, from the dependency graph (`§4.3`), for each requirement the feature specs that list or cite it, for each feature spec the architecture specs that do, and for each spec the items it covers. Two views are returned: all items with their coverers, and uncovered items only. Uncovered requirements and feature specs are warnings (`§6.3`). Exempt: requirements `R62`, `R63` and their sub-requirements, and IDs in `coverage.requirement_only` (`verification R64`). Absent layers are skipped; several coverers are all shown and not warned. Both views are available to people and, under `info.retrieve`, to the LLM.

## §7 Roles, permissions and presets

Implements `roles-and-permissions R42`, `roles-and-permissions R42.1`, `roles-and-permissions R42.2`, `roles-and-permissions R44`, `roles-and-permissions R46`, `roles-and-permissions R50`, `roles-and-permissions R55`, `roles-and-permissions R56`, `roles-and-permissions R56.1`, `roles-and-permissions R57`, `configuration R54`, `cli R16.1`, `cli R17.1`, `cli R17.2`.

### §7.1 Which role runs

The role is chosen by the front end, never by arguments, files in the project, or anything an LLM can write:

- The CLI runs as `standard-user`. `specplane role switch administrator` writes `role.json` in the local store (`§3.3`); until `specplane role switch standard-user`, CLI calls on this machine run as the Administrator. With no mapping configured anyone may switch (`roles-and-permissions R44`). A role mapping is a later release (`§15`).
- The harness adapter runs LLM actions as `llm`. A subagent has the role of the LLM that started it (`roles-and-permissions R42.1`); the adapter does not distinguish them in the first release.
- A person's typed harness command runs through the user-command runner as `standard-user` (or the switched role), never as `llm` (`harness R18`).
- Every guarded call carries `Actor {role, kind: human|llm, name, model?, session?}`; the audit log records it (`§9`).

### §7.2 Catalog and presets

`catalog.ts` holds the permission IDs of `architecture/file-formats §7.1` with, per permission: description, what it does not allow, the commands that use it, and its steering text key (`configuration R54`). `presets.ts` embeds the four default presets in the shape of `architecture/file-formats §7.2` and exposes `mode(preset, role, permission)`: role entry, else role `default_mode`, else preset `default_mode`, else `deny`. The Administrator is hard-coded to `allow` for everything and is not a preset. A permission needed by a command that is not in the catalog is a validation finding (`§7.4`).

### §7.3 Guard

`guard.ts` is the one enforcement point (`roles-and-permissions R55`, internal restriction).

```
guard(ctx, permissions[], describeAction) ->
  { kind: "allow", token: Authorized }
  { kind: "request", permission, requestDraft }
  { kind: "deny",  permission, message }
```

- A command declares the list of permissions it needs (`roles-and-permissions R50`: a command may need several). The result is `deny` if any is `deny`, else `request` if any is `request-user`, else `allow`. The permission named is the first one that decided the result.
- Granular metadata permissions: `meta.write.<piece>` or `meta.write`, and the more permissive mode wins (`cli R17.1`). Protected overrides never fall back to `meta.write` (`cli R17.2`).
- `Authorized` is an opaque value holding the permissions and the actor. Every mutating core function (write spec metadata, approve, record result, write config, plan flows, accept request) takes one as its first argument; no front end can build it. A function that needs two permissions checks the token covers both (type check plus a runtime check). Read-only operations (reads, validation, warnings, coverage, running tests, audit reading) are guarded by `info.retrieve` (`verification §2.2`): the guard decides `allow` or `deny` for them like any other action, but they write nothing and so take no `Authorized` token. `request send` needs no permission (`roles-and-permissions R50`) and takes no token.
- On `deny` the message names the permission, says the action is refused, and tells the LLM not to look for another way (`steering R51`). On `request` it creates the request draft (`§8`). A refused or held action runs no part of the operation (`roles-and-permissions R50`).
- The audit writer is called by the guard for every decision (`§9`), including refusals; the command runner also audits every command, reads included (`§9`).
- A permission shared by several commands is evaluated by the same function and therefore has one mode (`roles-and-permissions §2`).

### §7.4 Documentation

`specplane permissions` lists every permission with the mode in the active preset for each role; `specplane permissions <id>` shows its full documentation: what it allows and does not, commands, mode per default preset, the reader's own role and mode, and the complete steering including custom steering (`configuration R54`). The harness serves the same function (`§12.5`). Changing the preset changes what is shown on the next command (`configuration R54`). Validation warns when a catalog entry has no description or steering key, and fails the build in tests when a preset lacks an entry for a catalog permission it should state (`steering R51`). **Test (assumption, deterministic):** for each default preset, the mode of every catalog permission for Standard User and LLM equals the table and lists of `roles-and-permissions R57`, using the complete example of `architecture/file-formats §7.2`.

### §7.5 What is not enforced

Roles are not airtight (`roles-and-permissions R55`). The first release enforces through `guard.ts` and the harness block of `§12.7`. In particular the Administrator switch is a local file (`role.json`, `§7.1`) that any process able to run the CLI would also honour; an LLM with a shell tool is kept from the CLI only by the best-effort hook of `§12.7`, which is acceptable under `roles-and-permissions R55`. Tying the switch to a person's terminal belongs with strict mode (`§15`). Strict mode and bypass guards are later releases (`§15`).

## §8 Requests

Implements `requests R52`, `requests R52.1`, `requests R52.2`, `requests R52.3`, `requests R52.4`, `requests R52.5`, `plan-execution R27.5`, `plan-execution R27.5.1`, `plan-execution R27.5.2`.

- **Store.** `requests/store.ts` reads and writes `requests/<id>.json` with the schema of `architecture/file-formats §9.2`, validated with `ajv`. IDs come from the clock and four random hex digits. Writing is temp-file and rename; two writers cannot both accept a request because accept re-reads the file and refuses unless `state` is `pending` (compare-and-set).
- **Sending.** When the guard returns `request`, the front end calls `requests.create` with the guard's draft: the sender, permission, action (`command` and `params`), reason, base branch and commit, plan id, blocking flag. For a spec edit, `params.patch` is a unified diff of the proposed change against the base and `diff` is the same text rendered against the last approved version (assumption: the patch is stored so accept can apply it). The LLM-facing reply says a request was sent and that nothing was done.
- **Deny sends nothing.** A role with `deny` creates no request (`requests R52.3`). A role with `allow` creates one only when the LLM chooses to through the `request.send` action, under steering (`steering R59`); the harness records it with the permission the action would need.
- **List and show.** `specplane requests` and the harness pane list pending first, then answered. `requests show <id>` prints sender, action, reason, and for specs the diff in git diff form with colour on a terminal (`requests R52.1`, `requests R52.4`). The diff is recomputed at show time against the current approved version; a never-approved spec shows all lines as additions.
- **Accepting.** `accept <id>` runs: re-read the record, require `pending`; build a guard check with the accepting person's role and the request's permission list, requiring `allow` (a role whose mode is `request-user` or `deny` cannot accept, and the missing permission is named, `requests R52.2`); re-check the action against the current state (the same preconditions as direct execution; the base is only context); run the action once under that authority with the accepter as actor and the request id in the audit entry; set `accepted` with `answer {by, date, note}`. If the action cannot be done (plan gone, patch does not apply, content changed since a test ran) the user is told and the request becomes `failed` with `error` (assumption beyond `requests §2`, `architecture/file-formats §9.2`: it is answered and not retried). An LLM role never accepts: the front end for `llm` has no `accept` or `decline` action (`roles-and-permissions R57`).
- **Declining** sets `declined` and changes nothing else.
- **Blocking requests.** In a plan run `request.send` takes `blocking: bool` (`plan-execution R27.5`). A blocking request soft-stops the plan with reason `waiting for request <id>` (`§11.3`). When it is accepted or declined and the plan is stopped for that reason, the response includes `resume: <plan-id>`; the harness resumes the plan if a session is active, otherwise the plan stays stopped until `plan resume`. The answer is part of the resume context (`plan-execution R27.5.1`). Non-blocking requests only record `blocking: false`. The final review lists pending ones for the plan (`§11.6`, `plan-execution R27.5.2`).
- **Notifications.** After a request is stored, if `notifications.push` is on and the permission is in `notifications.push_permissions`, the adapter's `notify(summary)` is called with a short text and no content (`requests R52.5`). A harness without `notify` ignores it. The list and dialogue are the only places a request is answered.
- **Dialogue.** If a session is active, the adapter opens the dialogue for each new request in order; closing it leaves the request pending (`requests R52.4`).

## §9 Audit log

Implements `verification R13`, `verification R13.1`, `configuration R25.1`.

- `audit/log.ts` appends one JSON line per decision or action in the format of `architecture/file-formats §10`: time, branch (`git branch --show-current`, or the short commit when detached), actor, command, arguments, permission, outcome (`done`, `refused`, `request-sent`, `cancelled`, `failed`), reason and for changes `old` and `new`. No file content and no test output are written (`verification R13`).
- Entries are produced in three places: the guard (every decision), the command runner (`done` or `failed` after the operation, `cancelled` on interrupt, and for every command it runs, reads included, because `verification R13` covers all actions), and the request code (`request` id). A guarded action therefore has at least two entries only when it ran after a request; the runner merges the guard and result for the same call into one line where it can (assumption).
- A failed append sets a flag read by the warnings collector and prints one warning at the end of the command; the action proceeds (`verification R13`). The writer never throws into the caller.
- **Retention** (`audit.retention`): at the start of each command that is not `audit`, entries older than the retention are dropped by rewriting through a temp file and rename, and one entry `audit prune` records how many and the oldest date kept (`verification R13.1`). `forever` skips it. Concurrent commands race harmlessly: the rewrite re-reads the file and keeps any line appended meanwhile (assumption: rewrite takes a `audit.lock` file created with `wx` and skips pruning if it exists).
- `specplane audit [--since <date>] [--branch <name>] [--actor <role>] [--json]` reads it. For an LLM the same read needs `info.retrieve` (`§12.1`). Lines that do not parse are skipped and counted in a warning.

## §10 Tests, results and implementation status

Implements `verification R36`, `verification R36.1`, `verification R36.2`, `verification R61`, `verification R61.1`, `verification R61.2`, `verification R61.3`, `verification R61.4`, `verification §2`, `verification §3`, `configuration R25`.

### §10.1 Declarations

`tests.ts` reads Test lines from the section index (`§4.2`) and gives each the ID `<section id>#<n>` (`architecture/file-formats §11.2`). A section with no Test line has the implicit test `<section id>#0`, kind `intelligent`. An implicit test exists for every `## R<n>` and `## §<n>` heading of a spec that declares nothing in it; a spec's own result set is the union over its sections.

**Runnable definition (assumption).** A deterministic test can be run by the CLI only if the Test line is followed, before the next blank-line-separated paragraph, by a fenced block with the info string `specplane-test`:

```yaml
run: ["specplane", "validate", "--json"]   # argv array, no shell
cwd: .                                     # relative to the checkout, default "."
setup: [["sh", "scripts/make-fixture.sh"]] # optional argv list run first
expect:
  exit: 1
  stdout-contains: ["unresolved cite"]
```

The block is part of the section, so editing it is a content edit. A deterministic Test line with no block cannot be run by the CLI and is reported as `not run: no runnable definition`; an LLM in a harness may run it by following the prose and record the result as that LLM. Intelligent tests are never run by the CLI (`verification §2.1`).

### §10.2 Running

`specplane test run [<spec-id>[#section]] [--all]` and the harness action `test.run` call the same function.

1. Needs only `info.retrieve` (`verification §2.2`).
2. Reads the committed content at HEAD. To run against it, the runner creates a temporary checkout of HEAD with `git worktree add --detach <tmp>` under `<store>/tmp/`, runs each test there, and removes it (assumption: this makes "committed state" true when the working tree is dirty). If the working tree differs the output says the committed state was tested (`verification R36.2`, `verification §2.2`).
3. Each test starts its argv without a shell, with a clean environment plus `SPECPLANE_TEST=1`, a wall-clock limit of 120 seconds (assumption, `--timeout` overrides) and output captured. The `expect` keys are `exit`, `stdout-contains`, `stderr-contains`, `stdout-equals` (assumption). A failure summary names the failed expectation and the first lines of the difference.
4. The result per test is `passed`, `failed` or `not-run` (harness missing, no definition, interrupted). An interrupted run records nothing and the audit log gets `cancelled` (`verification §3`).
5. Output goes to the log (`§10.5`), not to the result.

### §10.3 Recording

`tests.record` writes one entry into the tested spec's `results` (`architecture/file-formats §11.1`) after the guard returns `allow` for `test.record`:

- `kind`, `outcome`, `by` (the actor), `date`, `commit` (HEAD tested), `fingerprint` (`specFingerprint` of that spec at that commit), `against` (fingerprints of the specs it was checked against: the specs it `covers` or `implements`), `summary`, optional `log`.
- Under `request-user` the test still runs and its outcome is shown; a request is created holding `{spec, test, outcome, summary, commit, fingerprint}`. On accept, the record is written only if HEAD's fingerprints still equal those in the request; otherwise nothing is recorded and the user is told why (`verification R61.2`).
- Under `deny` the outcome is shown with the note "not recorded".
- A summary that looks like a credential gives a warning but is recorded (`§6.2`).
- Recording uses the metadata write path and does not change status. Writing `results` is excluded from the fingerprint, so it is not an edit (`architecture/file-formats §4.2`).
- Override: `specplane spec override test <id> <test> passed|failed|clear` needs `override.test` and writes `override: {by, date}` into the result (`cli R17.2`, `architecture/file-formats §11.1`).

A result is **current** when its `fingerprint` and every `against` fingerprint equal the ones computed at HEAD now, else **outdated**; the effective result per test is the latest current one (`verification R61.1`, `verification §3`). Approval and mark-implemented use only current results: a current `failed` blocks them and names the test; outdated results count as none.

### §10.4 Implementation status

`implementation.ts` implements `specplane spec implement <id>` (also a harness action). Only architecture specs carry the field (`architecture/file-formats §11.3`).

1. Needs `test.record` with mode `allow` for the actor, and for the `llm` role the setting `architecture.llm_may_mark_implemented` to be on (`verification R36.1`).
2. Takes `commit = HEAD`, noting when the working tree differs from it, and runs the checks at that commit: all deterministic tests (`§10.2`), plus an intelligent verdict for every section that declares nothing or declares intelligent tests. Intelligent verdicts exist only as current results recorded through `tests.record` by an LLM in a harness; from the CLI they are reported as `needs harness`, and the command ends with the status unchanged (`verification R36.1`).
3. Writes `implementation: {status: implemented, commit, fingerprint, by, date}` only when every test and section has a current `passed`.
4. A current `failed` refuses and names it (`verification R36`).
5. Reading status: `implemented` only if the block's fingerprint equals the HEAD fingerprint and `commit` is an ancestor of HEAD (`git merge-base --is-ancestor`); otherwise the block is removed by the next writing command and meanwhile shown as unimplemented with the reason (`verification R36.2`).

### §10.5 Logs

A test run writes `<log-id>.log` according to `tests.logs`: `local` to `<store>/logs/`, `git` to `<paths.test_logs>/` (`architecture/file-formats §6`) with a warning printed when selected and on each write, `off` none (`architecture/file-formats §11.4`, `verification R61.4`). Retention of local logs runs with audit retention at command start and is audited. Logs are text with a header (spec, test, commit, actor) and the captured output; the intelligent session text is supplied by the harness adapter when recording.

## §11 Plans

Implements `plans R28`, `plans R28.1`, `plans R29`, `plans R29.1`, `plans R29.2`, `plans R29.3`, `plans R30`, `plans R30.1`, `plans R69`, `plans §2`, `plans §2.1`, `plans §2.2`, `plans §3.1`, `plan-execution R27`, `plan-execution R27.1`, `plan-execution R27.1.1`, `plan-execution R27.2`, `plan-execution R27.2.1`, `plan-execution R27.3`, `plan-execution R27.4`, `plan-execution R27.6`, `plan-execution R31`, `plan-execution R31.1`, `plan-execution §2`, `plan-execution §3`.

### §11.1 Parse and validate

`plan/parse.ts` reads a plan folder (active or archived) per `architecture/file-formats §5`: PLAN.md frontmatter and body, step files, `progress.yaml`, handoff entries and gap entries. `plan/validate.ts` produces findings for: ID versus folder, steps contiguous from 01 with matching `step` and `plan` fields, `implements` and `context` cites resolving, the latest handoff outcome agreeing with `done`, gap IDs counting up, reference cycles, a missing referenced plan, and the outdated-reference warning: a plan's recorded commit for a spec differs from the latest commit that changed that spec on the current branch (`git log -1 --format=%H -- <path>`), naming plan, spec and both commits (`plans R29.3`). Project without plans: nothing (`plans R69`).

### §11.2 Status and next step

`plan/next.ts` computes, from `progress.yaml` and the step list, the **next step** (lowest-numbered step not in `done`) and its readiness. A step is **waiting** when it lists a spec in `implements` whose effective status at the plan branch HEAD is not `approved` (`plans R30.1`, `plan-execution R27`); the reply names the spec. A selection (next, N steps, all remaining) is validated: it must start at the next step and a waiting step ends the selection there; a selection starting later is denied naming the next step (`plan-execution R27`). Plan status shown to users is `progress.yaml` `status`, except that `in-progress` with no live run marker is reported `stopped` with reason `session ended unexpectedly` without rewriting the file (`§11.3`, `plans R29.1`). `plan list [--live]` reads the plan folder of the checkout the command runs in; `--live` reads each running plan's own checkout through `worktrees.json` and merges, with a path git no longer lists dropped (`architecture/repository-layout §3`).

### §11.3 Start, run marker, stop, resume

- **Start** (`plan start <id> [--target <branch>] [--force-deps <ids>]`; `plan.start` permission, `plan-execution R31.1`). Order: guard; load the plan from the current checkout; check start conditions when `plans.start_conditions` is on: the plan and every spec in its `implements` entries with `mode: implements` and its `references` are effectively approved at the target tip, naming each that is not (`plan-execution R27.6`); a referenced plan must be `completed` unless named in `--force-deps`, which the handoff records (assumption, as the feature spec); a reference cycle always refuses. Then: target is `--target`, else the current branch; record `target_branch` and `start_commit`; `git worktree add -b plan/<id> <path> <target-commit>` where `<path>` is from `architecture/repository-layout §3`; record the path in `worktrees.json`; run `plans.setup_command` in the new directory, and on failure remove the worktree and branch and fail with the command's output; write `progress.yaml` with `status: in-progress` in the new worktree and commit it (`chore(specplane): start <id>`, `architecture/file-formats §8`). The main checkout is untouched. Starting writes the first run marker.
- **Run marker.** While a session works, the adapter keeps `runs/<plan-id>.json` `{session, pid, heartbeat}` updated every minute and removes it on a clean end (assumption). A status read treats a marker whose heartbeat is older than five minutes, or with a dead pid on this machine, as no run.
- **Step finished** (`plan step-done <id> --step N --outcome done|partial`, harness action `plan.step-done`): requires a handoff entry for the step with the same outcome and all sections (`architecture/file-formats §5.5`); requires a commit on the plan branch since the step began (an entry-only commit is created if there is none, `plan-execution R27.4`); for `done` appends `N` to `done` and advances `current_step`; commits `progress.yaml`. Claude Code's step command records the step itself and the agent never runs this directly (`AGENTS.md`); the function is the same.
- **Stop** (`plan stop <id> [--reason ...]`, harness `plan.softstop`): sets `status: stopped` with `stop {kind, reason, needs}` after the LLM wrote the handoff entry; commits. Kinds: `soft` (LLM or budget soft stop), `user`, `hard` (harness ended the session by force; written by the adapter, or by the next status read when it finds the marker stale after a budget hard stop was logged), `failure`. A soft stop by the LLM needs `plan.softstop` (allow in every default preset). A block is never turned into a skipped step.
- **Resume** (`plan resume <id>`; `plan.resume`). Not available for `completed` or `abandoned`. Re-creates the worktree from `plan/<id>` if gone (`git worktree add <path> plan/<id>`), clears `stop`, sets `in-progress`, commits, and returns a **resume context**: the plan's next step, handoff entries, any answers to requests that stopped it, and for a `hard` or `failure` stop or an unexpected end the session log pointer the adapter holds for `progress.yaml` `session`. After a soft stop the context has no session log (`plan-execution R27.2`). Start conditions are not rechecked. If `target_branch` no longer exists the plan stays stopped asking for a new target, set by `plan retarget <id> --target <branch>` (assumption).
- **Selection never skips**: resume continues at the first step not done.

### §11.4 Budgets

`budget.ts` stores per plan a list `{resource, soft, hard}` in the plan's `progress.yaml` `budget` field (`architecture/file-formats §5.4`; plan metadata, `plan-execution R27.1`), committed on the plan branch with `chore(specplane): budget <id>`, set by `plan budget <id> --resource <name> --soft <n> --hard <n>` under `plan.budget` (`plan-execution R27.1.1`). A resource is a name the adapter reports (tokens, `5h`, `weekly`); the adapter publishes `measurable(resource)`; a budget on an unmeasurable resource is refused with the reason (`harness R35.1`). During a run the adapter calls `evaluate(plan, usage)`: at soft it tells the LLM to bring the work to a safe point, commit and write the partial handoff, then calls `plan stop --kind soft --reason "soft stop at 80% of the weekly limit"`; at hard it ends the session and records `stop.kind: hard`. No budget means no check. Budgets never span plans. Usage readings are held by the adapter and not stored; the soft or hard stop that ended a run is the `stop` entry of `progress.yaml`.

### §11.5 Create and edit (LLM)

`plan.create` writes the folder from a template and commits it (`docs(<slug>): create plan`; `plan.edit` commits `docs(<slug>): edit plan`, `architecture/file-formats §8`): ID `<today>-<words>` (two to four lowercase words, `architecture/file-formats §5.1`), PLAN.md with `status: awaiting-review`, an empty `progress.yaml` with `status: not-started`, and step files. Needs `plan.create`; `plan.edit` for later changes, including adding or removing steps. Editing a step that has started is refused except to later steps; deviations go in the handoff. Neither approves anything (`plan-execution R31`, `plan-execution R31.1`). Plan approval is the spec approval flow of `§5.3` applied to PLAN.md.

### §11.6 Final review and finishing

- **Open.** When `done` covers every step, or on request, `plan review <id>` assembles: per step the handoff outcome and changes; open gap entries; unrun steps; pending requests whose `plan` is this plan; acceptance criteria from PLAN.md for the LLM to mark met or not with evidence (the CLI lists them and does not decide); referenced specs whose content changed on the target branch since `start_commit` (compare `specFingerprint` at `start_commit` and at the target tip, with the effective status at the tip) and, separately, specs changed on the plan branch (`plans R28.1`). The target tip seen is stored in `reviews/<plan-id>.json`. The plan stays `in-progress`.
- **Decide.** `plan finish <id> --complete | --back <reason>` needs `plan.complete` (`plan-execution R31.1`); under `request-user` a request goes to the user. `--back` sets `final_review {decision: back-in-progress, reason, by}` and leaves `in-progress`; steps may then be added. `--complete` sets `status: completed`, writes `final_review`, moves the plan folder to `<plans.dir>/archive/<id>/` and commits both as the plan branch's last commit (`chore(specplane): finish <id>`), so a merge brings the archived plan (`plans R28`, `plans R29.2`). Completion is a declaration; it is not conditional on tests.
- **Merge** is separate: `plan merge <id> --pr | --local` (also the harness action `plan.merge`, guarded by `plan.complete`, `architecture/file-formats §7.1`). `--pr` pushes nothing itself; it runs `gh pr create` when `gh` is available and otherwise prints the branch to open (`§1`). `--local` runs only in a checkout of the target branch without uncommitted changes and refuses when the target tip differs from `reviews/<plan-id>.json` until the review is shown again; it runs `git merge --no-ff plan/<id>` and on conflict stops, runs `git merge --abort`, and shows the conflicting paths. Specplane never resolves conflicts. After a merge it removes the worktree (refused if dirty unless `--force`) and deletes the branch (`plan-execution §2`, `plan-execution R27`).

### §11.7 Abandon and delete

`plan abandon <id>` (`plan.abandon`): stop the run first, then, in the checkout where the command was run, bring the plan folder from the plan branch (`git checkout plan/<id> -- <plan dir>`), set `status: abandoned`, move the folder to the archive and commit; remove the worktree unless it has uncommitted changes (then ask, or `--force`); keep the branch (`plan-execution §3`). `plan delete <id>` (`plan.delete`): stop the run, remove the folder and commit, remove the worktree under the same rule; references to it are reported missing by validation (`plans R29.2`). Both are audited.

## §12 Harness-facing actions, steering and retrieval

Implements `harness R14`, `harness R18`, `harness R19`, `harness R19.1`, `harness R19.2`, `harness R20`, `harness R20.1`, `harness R26`, `harness R26.1`, `harness R26.2`, `harness R34`, `harness R35`, `harness R35.1`, `harness R47`, `harness §2`, `steering R51`, `steering R59`, `steering R59.1`, `steering R22`, `steering R23`, `configuration R54`.

### §12.1 Actions

`harness/actions.ts` holds a registry `{id, permissions, input schema, handler}`; each handler calls the same core function as the CLI with `Actor {role: llm}` and returns a result object plus the instruction text the adapter attaches (`§12.3`). The set for the first release: `spec.retrieve`, `spec.list`, `spec.create`, `spec.edit`, `spec.delete`, `spec.approve`, `spec.meta.read`, `spec.review-context`, `spec.implement`, `validate`, `warnings`, `coverage`, `test.run`, `test.record`, `config.get`, `config.set`, `permissions.docs`, `docs.search`, `audit.read`, `request.send`, `plan.create`, `plan.edit`, `plan.list`, `plan.next`, `plan.step-done`, `plan.softstop`, `plan.start`, `plan.resume`, `plan.abandon`, `plan.delete`, `plan.budget`, `plan.review`, `plan.finish`, `plan.merge` (guarded by `plan.complete`, assumption), `warnings.report` (no permission, adds a warning for the current session only, `§6.1`). Read-only actions need `info.retrieve` (viewing, review, validate, warnings, coverage, test runs, audit, docs, `plan.list`; they have no permissions of their own, `harness R26.2`). Spec writes need `spec.create|edit|delete.<type>`; approval `spec.approve`; plan flows `§11`. There is no `request.accept` or `request.decline` and no `role.switch` action (`§8`, `§7.1`). Authorship: `spec.create` and `spec.edit` append the LLM as author with a contribution when `authorship.record_llm` is on, using the model the adapter reports and `unknown` otherwise; they never add a human (`harness R19.1`, `specifications R10`).

`spec.edit` accepts either replacement text of a section or a whole-file replacement, applies it, and when it changes content on an approved spec writes the review-state fields (`§5.4`); under `request-user` it stores a patch (`§8`) and writes nothing. `spec.create` writes frontmatter with `status: awaiting-review`, the chosen ID and cites. The harness never accepts an `approved` status or an `approval` block from the LLM in any write: such keys in supplied text are rejected (`harness R20`, `roles-and-permissions R57`).

### §12.2 User commands

Harness commands typed by the person (`/requests`, approval by ID, status panes, viewing) are implemented by the adapter running the matching core function in the user-command runner with role `standard-user` and no model call; with arguments it passes the arguments and the command's instructions to the LLM (`harness R18`). `harness R21` viewing and `harness R38` review are later release and are built on `spec.retrieve` and the diff routine of `§8` (`§15`). The runner is a small process the harness hook invokes (`specplane harness run <command> [args]`, assumption); it is not a general route to the CLI and refuses commands outside the harness command list.

### §12.3 Instruction delivery

`instructions.ts` implements `harness R14`. Each command and each permission has an instruction text (default: its documentation, `steering R22`, replaced by `harness.instructions.<command>` when configured). Replacement changes text only; limits in `§7.3` still apply (`harness R14`).

- Per session, `sessions/<session-id>.json` lists `{key, hash}` of instruction texts already delivered and the compaction epoch. `deliver(session, key)` returns the text unless the same hash was delivered in the current epoch.
- A harness that reports compaction (a hook) calls `epoch++`, which makes everything deliverable again. An adapter that cannot report its context state never marks anything delivered, so instructions are sent again when unsure (`harness R14`).
- A harness that can load instructions on demand (skills) gets a pointer to the skill instead of text; the behaviour is the same.
- If the adapter cannot deliver at a command, it delivers at the nearest earlier point, usually session start, and returns a notice that the user sees (`harness R35.1`).

### §12.4 Steering

`steering.ts` generates steering from templates in `assets/steering/` filled with data, never free text from the model: the actor's role, the mode of each permission under the active preset, the commands, and the five cases of `steering R59` (request-user, deny, user-run command, allow, plan block) plus the blocking-request guidance and the layer rules. Output per role: a short always-loaded part (role, limits, no-bypass, the rule that checks and not steering decide) and per-permission and per-command parts delivered with the command (`steering R51`). Custom steering from `steering.custom` is appended after the generated text of the same permission or command, a general item before a specific one and labelled so the specific one wins on conflict, and never replaces the no-bypass text (`steering R59.1`). `specplane steering <command|permission>` prints exactly what an LLM receives (`steering R59.1`, `configuration R54`).

Every generated text carries a stamp `sha256(preset id + preset version + custom steering + Specplane version)`. Delivered files (`§12.7`) embed it; the warnings collector compares it to the computed stamp and warns when missing or different (`steering R59`). Steering is regenerated, and installed files rewritten when owned, when `permissions.preset` or `steering.custom` changes (`§3.2`); if regeneration fails the old text is replaced by a short notice that it cannot be trusted and a warning is raised, never left claiming more than the role has.

### §12.5 Retrieval and documentation

- `retrieve.ts` implements `harness R26`: for each named spec, return the spec text and, when `harness.retrieval_include_references` or the call asks, every part its `covers`, `implements` and `references` cites resolve to, each with its source cite, deduplicated, and only that part (the section and its subsections). A cite that does not resolve is returned as `not found`. Specs and parts that are effectively `awaiting-review` are marked. The request may name several specs. Spec text is read from the working tree (the LLM works on it), status from HEAD; a note says when they differ (assumption). It is read-only and needs `info.retrieve` (`harness R26.1`, `harness R26.2`).
- Documentation (`steering R22`, `steering R23`): the user documentation is written in the repository's `docs/user/` (`architecture/repository-layout §1`) and copied by `build-docs` to markdown under `assets/docs/` with a manifest. The manifest lists the required topics: the specification, plan and configuration formats, every command, every configuration key with its default, every permission, and five mandatory notes: group approval (`cli R16`), a role with `allow` approving without confirmation (`harness R20.1`), the audit retention default (`verification R13.1`), the warning about private information in logs kept in git (`verification R61.4`), and which commands and capabilities each harness supports (`harness R35.1`). **Test (assumption, deterministic):** the build fails when a catalog permission, a command or a configuration key is missing from the documentation, shown without its default, or when a mandatory note is missing (`steering R22`). `build-ai-docs` generates the AI-facing form deterministically from it: an always-loaded essentials file under a size limit (checked in tests) and a searchable remainder. `specplane docs [topic]` and `docs search` read the bundle offline; `docs.search` is the harness action. Generated files are never hand-edited and are rebuilt by the package build.
- `specplane permissions` output (`§7.4`) is shared by CLI and harness.

### §12.6 Setup and staleness

`harness/install.ts` installs the files of one named harness (`harness R34`: the user names it) into the places of `architecture/repository-layout §5`: owned files are written with a version header; standing instructions go to an owned file, or to the marked block in a shared file that is created if absent and changed only between its markers (`harness §2`). The standing text is fixed and short: Specplane is in use, read `.specplane/config.yaml` and resolve paths from it, look up steering (`harness §2`). A block that is unbalanced stops setup with an error. `harness` findings in validation: installed file missing, version header older than the CLI, stamp mismatch, marker problems. Two harnesses share one block (`harness §3`). Each adapter implements `capabilities()` (instructions on demand, push, subagents, viewing, usage measurement, command blocking, session opening); setup and every action state which are missing and refuse rather than substitute (`harness R35.1`).

### §12.7 Keeping the LLM off the CLI

Enforcement of `harness R47` has two parts. Core exports `isSpecplaneCommand(shellText)`, which splits the text into simple commands (handling `;`, `&&`, `|`, subshells, `env` prefixes, `sh -c`, `npx`, `bunx` and path-qualified `specplane`) and reports a match. Each adapter installs a pre-tool hook that calls it for shell tool calls and denies a match with a message pointing to the harness actions; a harness without such a hook states that it cannot block (`harness R35.1`). The check is best effort; stronger guards (environment markers, headless detection) are later release (`§15`).

## §13 Human commands

Implements `cli R16`, `cli R16.1`, `cli R17`, `cli R17.1`, `cli R17.2`, `cli R33`, `cli R33.1`, `configuration R25`, `verification R12`, `verification R13`, `verification R24`, `verification R64`.

### §13.1 Command list

| Command | Does | Permission |
|---------|------|------------|
| `init --harness <name>` | Create `.specplane/config.yaml` if asked, install the harness files (`§12.6`) | `config.change` for the file |
| `validate [<id>...] [--json]` | `§6.1` | `info.retrieve` |
| `warnings [<id>]`, `coverage [--uncovered]` | `§6.3`, `§6.4` | `info.retrieve` |
| `spec list`, `spec show <id>` | Effective status, authors, results, implementation | `info.retrieve` |
| `spec approve <id>... [--yes]` | `§5.3` | `spec.approve` |
| `spec meta get <id>`, `spec meta set <id> <field> <value>` | `§13.2` | `meta.read`, `meta.write[.piece]` |
| `spec override status\|approver\|test ...` | `§13.2` | `override.*` |
| `spec reopen <id>`, `spec implement <id>` | `§5.4`, `§10.4` | `spec.edit.<type>`, `test.record` |
| `test run [<id>] [--all]` | `§10.2` | `info.retrieve` |
| `config get [<key>]`, `config set\|unset <key> [<value>]` | `§3.2` | `config.change` for writes |
| `permissions [<id>]`, `steering <command\|permission>` | `§7.4`, `§12.4` | none |
| `role show`, `role switch <role>` | `§7.1` | none |
| `requests [list\|show <id>\|accept <id>\|decline <id>]` | `§8` | permission of the requested action |
| `audit` | `§9` | `info.retrieve` |
| `plan list\|show\|next\|start\|stop\|resume\|review\|finish\|merge\|abandon\|delete\|budget\|retarget` (assumption, below) | `§11` | the plan permissions, `info.retrieve` for the read-only ones |
| `docs [topic]`, `docs search <text>` | `§12.5` | none |
| `check ...` | `§14` | none |

The permission column names the permission that guards the command; Standard User holds all of these, and a read-only command is checked against `info.retrieve` like any other (`§7.3`). Spec content is edited in an editor, not by a command. Plan metadata commands are a later release (`cli R33`, `§15`). **Assumption:** the feature specs say plans are managed through the harness (`plan-execution R31`) and give the CLI only plan metadata (`cli R33`, later release); the human plan commands above (`start`, `stop`, `resume`, `review`, `finish`, `merge --pr|--local`, `abandon`, `delete`, `budget`) are an addition so a person without a harness can run the same functions, and `plan retarget <id> --target <branch>` and `--force-deps` on `start` are assumptions with no counterpart in the feature specs. Every command accepts `--json`, and `--dry-run` where it writes: a dry run runs the guard and all checks and prints the writes it would do (assumption).

### §13.2 Metadata

`metadata.ts` reads and writes any frontmatter field of a spec through the YAML document, with the permission per piece: `title`, `authors`, `references`, `covers` and `approval` date and commit map to `meta.write.<piece>` (`cli R17.1`); `status`, `approval.by` and results map to the three overrides. An override writes the mark of `architecture/file-formats §2.4`, and for `override status approved` computes the fingerprints from the HEAD content so later edits reopen it (`cli R17.2`). All writes record `old` and `new` in the audit log (`cli R17`). Metadata writes do not change body or review state (`specifications R11.3`): `title`, `covers`, `implements` and `references` are outside the fingerprint (`architecture/file-formats §4.2`), so correcting them leaves an approved spec approved and refuse a field that is not one of those in `architecture/file-formats §2.1`. `plan meta` commands use the same code on PLAN.md (later release).

### §13.3 Output and errors

- Each command returns `{ok, data, findings, warnings}`; `text.ts` prints a short human form (what happened, then details), `json.ts` prints the object. Auto warn adds its line or field (`§6.3`).
- Exit status (assumption: the feature specs fix no exit codes beyond `verification R12`'s pass or fail): 0 success; 1 validation errors or a refused action; 2 usage error; 3 not a git repository or other environment error; 4 internal error. A held action (request sent) exits 0 and says so.
- Error classes in `errors.ts`: `UsageError`, `NotARepoError`, `GitError`, `FormatError` (carries findings), `PermissionError` (names the permission), `PreconditionError` (lists every reason), `RequestStateError`. Messages state what happened, where, and what to do next.

### §13.4 What is committed

Assumption: the page does not say which Specplane writes are committed, but under `specifications R40` an uncommitted change has no effect, so the rule is explicit.

- **Commit by the command**, as a metadata-only commit with the workflow and message of `architecture/file-formats §8`, staged by path and never including other files: `spec approve`, `spec reopen`, `spec override ...`, `spec meta set`, `test record` and `spec implement` (workflow `spec`), and the plan commands of `§11` that already say they commit (`start`, `step-done`, `stop`, `resume`, `budget`, `retarget`, `finish`, `abandon`, `delete`, `plan.create`, `plan.edit`). `--no-commit` leaves the change staged. If the spec file has other uncommitted changes than the keys the command wrote, the command writes the keys but does not commit, and says that nothing takes effect until the file is committed.
- **Left in the working tree**, because they are the person's or the LLM's own edits: `spec.create`, `spec.edit` (including the review-state keys a content edit writes, `§5.4`) and `config set`. Configuration is read from the working tree (`§3.2`), so it takes effect at once; spec content takes effect when the person commits it. The result text says "written, not committed".
- A commit under a request is made on accept, by the accepting person's command.

## §14 Pre-commit and CI checks

Implements `verification R12`, `verification R32`, `verification R36.3`, `configuration R25`.

### §14.1 CI

The earlier generated-index job no longer exists. The CI recipe is a documented command, not a generated workflow: run `specplane validate --json` on the checked-out commit; a non-zero exit fails the job. It reads committed content, needs no permission, no local store and no harness, and writes nothing. `specplane test run --all` may be added by a project; the `deterministic` runnable tests execute in the same temporary checkout and the job fails on `failed`. Neither records results in CI (no role records; assumption).

### §14.2 Pre-commit hooks (later release)

- `specplane check requirement-ids --staged` (setting `pre_commit.duplicate_requirement_ids`, `verification R32`): parses requirement files from the index (`git show :<path>`), reports duplicate IDs naming both places, exits 1 on any; it runs nothing else.
- `specplane check tests --staged` (setting `pre_commit.tests`, `verification R36.3`): finds architecture specs whose files are staged, exports the index to a temporary directory under `<store>/tmp/` (`git checkout-index --prefix`), runs their deterministic tests there, and exits 1 naming spec and test; never runs intelligent tests, never records results or sets implementation.
- **Install and remove.** `hooks.ts` manages sections in the file at `git rev-parse --git-path hooks/pre-commit`, bounded by `# specplane:begin <check>` and `# specplane:end <check>`; the file is created executable if absent. Turning a setting on inserts its section; off removes only that section and deletes the file if only the shebang remains; other lines are untouched (`verification R32`). `config set` applies it (`§3.2`); validation warns when a setting is on and its section is missing; a person may delete a section by hand without affecting others.

## §15 Later releases

Implements `roles-and-permissions R44.1`, `roles-and-permissions R60`, `harness R21.1`, `harness R38.1`, `later-releases R37.1`, `later-releases R39.1`, `later-releases R39.2`, `later-releases R39.3`, `later-releases R39.4`, `roles-and-permissions R43`, `roles-and-permissions R49`, `roles-and-permissions R55.1`, `roles-and-permissions R58`, `later-releases R37`, `later-releases R39`, `later-releases R66`, `plan-execution R31.2`, `harness R21`, `harness R38`.

Not built in the first release; each has a defined attachment point:

- **Custom roles, presets, management levels, role mapping, LLM role rules** (`roles-and-permissions R43`, `roles-and-permissions R49`): `roles.ts` reads `.specplane/roles/*.yaml` and `os-users.yaml` (`architecture/file-formats §7.4`) and `guard.ts` resolves the role from them; changes are request records. Nothing else changes in `§7.3`.
- **Strict mode and bypass guards** (`roles-and-permissions R55.1`, `roles-and-permissions R58`): extra checks in the adapters (a pre-edit hook blocking spec writes, an environment marker read by `role` resolution so a recognised LLM session never runs as `standard-user`) and git hooks installed like `§14.2`.
- **Decision records, subprojects, migration** (`later-releases R37`, `later-releases R39`, `later-releases R66`): a `decisions/` module behind `decisions.enabled`; a project registry behind `subprojects` extending the resolver of `§4.3`; the migration prompt is a harness instruction (`§12.3`).
- **Parallelism** (`plan-execution R31.2`): a `step_tasks` read in `plan/next.ts` and an adapter capability; steps still run in order.
- **Viewing and review commands** (`harness R21`, `harness R38`): adapter commands on `spec.retrieve` and the diff routine.
- **Plan metadata through the CLI** and the pre-commit checks of `§14.2`.
- **Left to the harness specs or a later release without a design here:** viewing and review permissions (`harness R21.1`, `harness R38.1`: they are the `info.retrieve` permission, `harness R26.2`), decision-record permissions (`later-releases R37.1`: catalog entries only, `architecture/file-formats §7.1`), the subproject rules (`later-releases R39.1`, `later-releases R39.2`, `later-releases R39.3`, `later-releases R39.4`: resolver prefix and unique IDs per project only, `architecture/file-formats §12.4`) and custom-user permissions (`roles-and-permissions R44.1`, `roles-and-permissions R60`).
