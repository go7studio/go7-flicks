import { Composition } from "remotion";
import { timelineEnd } from "../shared/model";
import { FlickComposition, emptyFlickProps } from "./FlickComposition";

export const RemotionRoot = () => {
  return (
    <Composition
      id="Flick"
      component={FlickComposition}
      durationInFrames={90}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={emptyFlickProps}
      calculateMetadata={({ props }) => {
        const seconds = Math.max(timelineEnd(props.clips), 1);
        return {
          durationInFrames: Math.max(1, Math.ceil(seconds * (props.fps || 30))),
          fps: props.fps || 30,
          width: props.width || 1080,
          height: props.height || 1920,
        };
      }}
    />
  );
};
