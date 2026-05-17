use crate::events::types::{runtime_health_event, LoomServiceEvent};
use axum::response::sse::{Event, KeepAlive, Sse};
use std::{convert::Infallible, time::Duration};
use tokio::time::MissedTickBehavior;
use tokio_stream::{wrappers::IntervalStream, Stream, StreamExt};

pub async fn events_stream() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let connected = tokio_stream::once(Ok::<Event, Infallible>(to_sse_event(
        runtime_health_event("connected".to_string(), "ready"),
    )));

    let mut interval = tokio::time::interval(Duration::from_secs(15));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let mut heartbeat_index = 0_u64;
    let heartbeat = IntervalStream::new(interval).map(move |_| {
        heartbeat_index += 1;
        Ok::<Event, Infallible>(to_sse_event(runtime_health_event(
            format!("heartbeat-{heartbeat_index}"),
            "ready",
        )))
    });

    Sse::new(connected.chain(heartbeat)).keep_alive(KeepAlive::default())
}

fn to_sse_event(event: LoomServiceEvent) -> Event {
    let event_type = event.event_type.clone();
    let event_id = event.id.clone();
    let data = serde_json::to_string(&event).unwrap_or_else(|error| {
        tracing::error!(%error, "failed to serialize loom-service SSE event");
        "{\"type\":\"runtime.health\",\"payload\":{\"status\":\"ready\"}}".to_string()
    });

    Event::default().event(event_type).id(event_id).data(data)
}
