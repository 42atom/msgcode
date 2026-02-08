Feature: UX - Control lane (P0)

  Scenario: Fast lane reply is not duplicated by queue lane
    Given a clean workspace root
    And control lane is initialized
    And I bind chat "any;+;bdd-control" to workspace "acme/ops"
    When I fast-lane execute "/where" for chat "any;+;bdd-control" as message "m-fast" rowid 123
    Then fast lane should have sent 1 reply
    When I queue-handle the same message for chat "any;+;bdd-control" as message "m-fast" rowid 123
    Then total replies should be 1
    And cursor for chat "any;+;bdd-control" should be at least rowid 123

  Scenario: Fast lane is idempotent (same rowid duplicated)
    Given a clean workspace root
    And control lane is initialized
    And I bind chat "any;+;bdd-control" to workspace "acme/ops"
    When I fast-lane concurrently execute "/help" twice for chat "any;+;bdd-control" rowid 456 as messages "m-1" and "m-2"
    Then fast lane should have sent 1 reply
