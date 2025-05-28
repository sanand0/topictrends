# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pandas",
#     "pyarrow",
#     "tqdm",
# ]
# ///
import os
import pandas as pd
import pyarrow.parquet as pq
import pyarrow as pa
import zipfile
from tqdm import tqdm


papers_file = "arxiv-metadata-oai-snapshot.parquet"


def get_papers():
    """Save specific fields from the arXiv metadata to a parquet file"""
    tqdm.write("Converting papers")
    source = "https://www.kaggle.com/datasets/Cornell-University/arxiv/"
    papers = "arxiv-metadata-oai-snapshot.json.zip"
    if not os.path.exists(papers):
        raise FileNotFoundError(f"Download {papers} from {source}")
    if not os.path.exists(papers_file):
        parquet_writer = None
        selected_fields = ["id", "categories", "title", "abstract", "update_date"]
        dtypes = {key: "str" for key in selected_fields}
        with zipfile.ZipFile(papers, "r") as z:
            with z.open("arxiv-metadata-oai-snapshot.json") as f:
                for chunk in tqdm(pd.read_json(f, lines=True, chunksize=100000, dtype=dtypes)):
                    table = pa.Table.from_pandas(chunk[selected_fields])
                    if parquet_writer is None:
                        parquet_writer = pq.ParquetWriter(
                            papers_file, table.schema, compression="snappy"
                        )
                    parquet_writer.write_table(table)
        if parquet_writer:
            parquet_writer.close()


if __name__ == "__main__":
    get_papers()
    tqdm.write("Reading papers")
    data = pd.read_parquet(papers_file)
    for category in tqdm(["q-bio.OT", "stat.OT", "q-fin.PM"]):
        if not os.path.exists(f"{category}.csv"):
            df = data[data.categories.str.contains(category, na=False)]
            df = df[["id", "update_date", "title", "abstract"]]
            tqdm.write(f"Saving {category} ({len(df)}) to {category}.csv")
            df.to_csv(f"{category}.csv", index=False)
