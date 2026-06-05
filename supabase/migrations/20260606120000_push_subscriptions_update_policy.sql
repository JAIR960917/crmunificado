-- upsert on push_subscriptions requires UPDATE when the row already exists
CREATE POLICY "Users can update own subscriptions"
  ON public.push_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
