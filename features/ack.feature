Feature: UX - Acknowledgement (M6-ACK-P0)

  Scenario: Non-slash message sends ack only after delay
    Given acknowledgement delay is 10ms
    When I run acknowledgement wrapper for content "hello" with handler duration 30ms
    Then I should receive 1 acknowledgement

  Scenario: Slash command never sends ack
    Given acknowledgement delay is 10ms
    When I run acknowledgement wrapper for content "/status" with handler duration 30ms
    Then I should receive 0 acknowledgements
