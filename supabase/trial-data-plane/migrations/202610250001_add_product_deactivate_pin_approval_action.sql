-- Explicit dedicated manager PIN scope for native catalog product deactivation.
-- Does not authorize permanent deletion or stock modification.
alter type approval_action add value if not exists 'product_deactivate';
