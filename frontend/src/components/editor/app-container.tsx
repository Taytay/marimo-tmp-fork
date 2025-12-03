/* Copyright 2024 Marimo. All rights reserved. */

import type React from "react";
import type { PropsWithChildren } from "react";
import type { AppConfig } from "@/core/config/config-schema";
import { PyodideLoader } from "@/core/wasm/PyodideLoader";
import { type ConnectionStatus, WebSocketState } from "@/core/websocket/types";
import { cn } from "@/utils/cn";
import { DynamicFavicon } from "./dynamic-favicon";
import { StatusOverlay } from "./header/status";
import { WrappedWithSidebar } from "./renderers/vertical-layout/sidebar/wrapped-with-sidebar";

interface Props {
  connection: ConnectionStatus;
  isRunning: boolean;
  width: AppConfig["width"];
}

export const AppContainer: React.FC<PropsWithChildren<Props>> = ({
  width,
  connection,
  isRunning,
  children,
}) => {
  const connectionState = connection.state;

  return (
    <>
      <DynamicFavicon isRunning={isRunning} />
      <StatusOverlay connection={connection} isRunning={isRunning} />
      <PyodideLoader>
        <WrappedWithSidebar>
          <div
            id="App"
            data-config-width={width}
            data-connection-state={connectionState}
            className={cn(
              "mathjax_ignore",
              connectionState === WebSocketState.CLOSED && "disconnected",
              "bg-background w-full h-full text-textColor",
              "flex flex-col",
              width === "full" && "config-width-full",
              // Canvas mode needs both overflow directions, columns needs x
              width === "canvas"
                ? "overflow-hidden"
                : width === "columns"
                  ? "overflow-x-auto overflow-y-auto"
                  : "overflow-x-hidden overflow-y-auto",
              "print:height-fit",
            )}
          >
            {children}
          </div>
        </WrappedWithSidebar>
      </PyodideLoader>
    </>
  );
};
