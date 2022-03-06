# Video

The `video` worker traps the `onGCSConnected()` and `onGCSDisconnected()` events and runs an `on_connect` (or `on_disconnect`) script to handle the event.
In this case, it tells the `udp-splitter` service to add (or remove) the client IP address to/from an internal table of video-streaming clients.
