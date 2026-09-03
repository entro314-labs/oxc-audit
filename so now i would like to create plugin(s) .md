so now i would like to create plugin(s) with custom rules to either to catch early or to correct antipatterns, errors, footguns, legacy conventions, old/deprecated patterns etc

i want you to go throught the prompts in folder and extract the antipatterns and suggestions as oxc (oxlint, oxfmt, oxlint type-aware) rules so we could put them in a plugin(s) and then we can run them on our codebase to catch and correct them


this is a oxc-audit tool, not oxlint-audit
so the idea is to use all oxc tools and theirs rules, even type aware ones
the logic is that i run the tool in my codebase and it applies by default a set of rules 
we can add flags that will force sets, like --react --next --vue etc and maybe by domain as well --security --performance --accessibility etc
we could add 4 levels too -- --basic --recommended --strict --paranoid
and in fact add a --dom flag that would enable all rules that matches a codebase 