[
  (closure)
  (map)
  (list)
  (argument_list)
  (parameter_list)
  (for_parameters)
] @indent.begin
(closure "}" @indent.end)
(argument_list ")" @indent.end)
(for_parameters ")" @indent.end)
((for_loop
  body: (_) @_body) @indent.begin
  (#not-has-type? @_body closure))
(list "]" @indent.end)
(map "]" @indent.end)
[ "}" ")" "]" ] @indent.branch
