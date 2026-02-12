Feature: Persona Boundary (v2.2)

  Scenario: /persona use with tmux runner warns about /clear requirement
    Given a clean workspace root
    And I bind chat "any;+;bdd-persona-boundary" to workspace "acme/ops"
    And workspace "acme/ops" has persona "coder" with content:
      """
      # Expert Coder

      You are an expert software engineer. Be concise.
      """
    When I run route command "/model codex" for chat "any;+;bdd-persona-boundary"
    Then the command should succeed
    When I run route command "/persona use coder" for chat "any;+;bdd-persona-boundary"
    Then the command should succeed
    And the output should contain "已切换到 persona"
    And the output should contain "/clear"
    And the output should contain "生效"
