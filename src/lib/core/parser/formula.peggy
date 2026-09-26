{{
// AST node constructors used by grammar actions
function variableNode(name) {
  return { type: "variable", name };
}
function notNode(operand) {
  return { type: "not", operand };
}
function binaryNode(type, left, right) {
  return { type, left, right };
}
function naryNode(type, first, rest) {
  if (rest.length === 0) return first;
  return { type, operands: [first, ...rest] };
}
}}

Formula
  = _ expr:Implication _ { return expr; }

Implication
  = left:ExclusiveDisjunction _ op:("→" / "->" / "↔" / "<->" / $("implies"i !IdentifierPart) / $("iff"i !IdentifierPart)) _ right:ExclusiveDisjunction {
      const type = (op === "→" || op === "->" || op.toLowerCase() === "implies") ? "implies" : "iff";
      return binaryNode(type, left, right);
    }
  / ExclusiveDisjunction

ExclusiveDisjunction
  = first:Disjunction rest:(_ ("⊻" / "⊕" / "^" / $("xor"i !IdentifierPart)) _ d:Disjunction { return d; })* {
      return naryNode("xor", first, rest);
    }

Disjunction
  = first:Conjunction rest:(_ ("∨" / "||" / $("or"i !IdentifierPart)) _ c:Conjunction { return c; })* {
      return naryNode("or", first, rest);
    }

Conjunction
  = first:Unary rest:(_ ("∧" / "&&" / $("and"i !IdentifierPart)) _ u:Unary { return u; })* {
      return naryNode("and", first, rest);
    }

Unary
  = ("¬" / "!" / $("not"i !IdentifierPart)) _ operand:Unary { return notNode(operand); }
  / Atom

Atom
  = "(" _ expr:Implication _ ")" { return expr; }
  / name:Identifier { return variableNode(name); }

Identifier
  = $([A-Za-z_] IdentifierPart*)

// A word operator must end where a word does, so a symbol that merely
// begins with one ("NotProofOfGod", "Orders") stays a single symbol.
IdentifierPart
  = [A-Za-z0-9_]

_ "whitespace"
  = [ \t\n\r]*
